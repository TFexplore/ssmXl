# 短信验证码中转系统设计文档

## 1. 项目概述

本项目旨在构建一个短信验证码中转服务。系统允许管理员配置一个监控目标URL，并从该URL实时获取短信数据。同时，管理员可以导入一批用于接收短信的COM端口与电话号码的映射关系。系统能够为指定的电话号码生成一个有时效性的、一次性的访问链接。终端用户通过此链接，可以获取与该号码关联的最新两条短信内容（通常是验证码），用于完成验证。

## 2. 核心功能

### 2.1. 管理员功能
- **系统配置**: 设置全局的 `targetUrl`，作为短信数据的监控来源。
- **号码管理**: 批量导入 `(COM, 电话号码)` 的映射关系。
- **链接生成**:
    - 为指定的电话号码生成一个唯一的访问链接。
    - 支持设置链接的冷却时间（例如，一个号码在24小时内只能生成一次链接）。
- **数据监控**: 查看从 `targetUrl` 抓取到的所有短信日志。

### 2.2. 用户功能
- **访问链接**: 通过管理员提供的唯一链接访问服务。
- **获取信息**: 在链接有效期内，获取与链接关联的最新两条短信信息。

### 2.3. 系统功能
- **数据抓取**: 后台服务持续监控 `targetUrl`，解析并抓取新的短信数据。
- **数据存储**: 将配置信息、号码映射、短信日志、访问链接等数据持久化到数据库。
- **链接管理**: 自动处理链接的生命周期，包括生成、验证和失效（因超时或成功获取信息）。

## 3. 数据库设计

我们将设计以下几张核心数据表来支撑业务逻辑。

### 3.1. `system_configs` - 系统配置表   注意：需要添加一个公告信息，管理员可以配置用户访问页面显示的注意事项等内容
存储系统的全局配置，如 `targetUrl`。

```sql
CREATE TABLE system_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE, -- 配置键，如 'targetUrl'
    config_value TEXT NOT NULL,               -- 配置值
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 3.2. `com_phone_mappings` - COM口与电话号码映射表
存储管理员导入的COM端口和电话号码的对应关系。

```sql
CREATE TABLE com_phone_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    com_port VARCHAR(50) NOT NULL UNIQUE,      -- COM 端口号
    phone_number VARCHAR(50) NOT NULL UNIQUE,  -- 电话号码
    last_linked_at TIMESTAMP NULL,             -- 最近一次生成链接的时间，用于冷却控制
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3. `sms_messages` - 短信消息记录表
存储从 `targetUrl` 监控并抓取到的所有短信数据。

```sql
CREATE TABLE sms_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    com_port VARCHAR(50) NOT NULL,             -- 关联的 COM 端口
    sender_number VARCHAR(50),                 -- 发送号码
    receiver_number VARCHAR(50),               -- 接收号码
    content TEXT NOT NULL,                     -- 短信内容
    original_timestamp TIMESTAMP NOT NULL,     -- 原始数据中的时间
    is_consumed BOOLEAN DEFAULT FALSE,         -- 是否已被链接消费
    consumed_by_link_id INT NULL,              -- (可选) 记录被哪个链接消费
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.4. `access_links` - 访问链接表
存储生成的访问链接及其状态。

```sql
CREATE TABLE access_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL UNIQUE,        -- 链接的唯一标识符 (e.g., UUID)
    mapping_id INT NOT NULL,                   -- 关联的 com_phone_mappings 表 ID
    status ENUM('active', 'completed', 'expired') NOT NULL DEFAULT 'active', -- 链接状态
    expires_at TIMESTAMP NOT NULL,             -- 过期时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mapping_id) REFERENCES com_phone_mappings(id)
);
```

## 4. API 接口设计 (RESTful)

### 4.1. 管理员接口
- `POST /api/admin/config`
  - **描述**: 设置或更新系统配置。
  - **请求体**: `{ "key": "targetUrl", "value": "http://example.com/sms-log" }`
  - **响应**: `200 OK`

- `POST /api/admin/mappings/import`
  - **描述**: 批量导入COM口和电话号码。
  - **请求体**: `[{ "com_port": "COM1", "phone_number": "13800138000" }, ...]`
  - **响应**: `201 Created`

- `POST /api/admin/links`
  - **描述**: 为指定电话号码生成一个访问链接。
  - **请求体**: `{ "phone_number": "13800138000" }`
  - **响应**:
    - `201 Created`: `{ "link": "http://your-domain.com/get-sms/a1b2c3d4-e5f6-..." }`
    - `429 Too Many Requests`: `{ "message": "Phone number is in cooldown." }`

### 4.2. 用户接口
- `GET /get-sms/:token`
  - **描述**: 用户通过唯一token访问，获取短信。
  - **路径参数**: `:token` - 链接的唯一标识符。
  - **响应**:
    - `200 OK`: `{ "messages": [{ "content": "...", "timestamp": "..." }, ...] }`
    - `404 Not Found`: `{ "message": "Link is invalid or has expired." }`
    - `202 Accepted`: `{ "message": "Waiting for new messages...", "messages": [] }` (当暂无新消息时)

## 5. 业务流程详解

### 5.1. 数据监控流程（相关逻辑严格按照index.js中已经实现的代码进行）
1.  系统后台启动一个定时任务（如每10秒一次）。
2.  任务访问 `system_configs` 表中配置的 `targetUrl`。
3.  获取页面内容，并与上次获取的内容进行比对，找出新增的行。
4.  解析新增的每一行数据，提取 `时间`, `COM`, `发送号码`, `接收号码`, `内容`。
5.  将解析后的数据作为一条新记录插入 `sms_messages` 表。

### 5.2. 链接生成流程
1.  管理员通过UI提交请求，为手机号 `P` 生成链接。
2.  后端API接收到请求，首先在 `com_phone_mappings` 表中查找手机号 `P` 对应的记录，获取其 `id` 和 
批注：改为系统自动获取不在冷却中的号码生成。
`last_linked_at`。
3.  检查 `NOW() - last_linked_at` 是否小于24小时。如果是，则返回冷却中错误。
4.  如果不在冷却期，生成一个唯一的 `token` (UUID)。
5.  计算过期时间 `expires_at` (当前时间 + 24小时)。
6.  向 `access_links` 表插入一条新记录，包含 `token`, `mapping_id`, `status='active'`, `expires_at`。
7.  更新 `com_phone_mappings` 表中对应记录的 `last_linked_at` 为当前时间。
8.  将生成的完整链接 `http://.../get-sms/{token}` 返回给管理员。
注意：需要删除该号码关联的历史消息。

### 5.3. 用户获取信息流程
1.  用户点击链接 `http://.../get-sms/{token}`。
2.  后端API通过 `:token` 在 `access_links` 表中查找记录。
3.  **验证链接**:
    - 如果找不到记录，或 `status` 不为 `active`，返回 `404 Not Found`。
    - 如果 `NOW() > expires_at`，将链接 `status` 更新为 `expired` 并返回 `404 Not Found`。
4.  **获取消息**:
    - 从链接记录中获得 `mapping_id`，并查询 `com_phone_mappings` 表得到关联的 `com_port`。
    - 在 `sms_messages` 表中查找 `com_port` 匹配且 `is_consumed = FALSE` 的记录，按 `original_timestamp` 降序排序，取最新的两条。
    - 如果找到两条消息：
        - 将这两条消息的 `is_consumed` 设为 `TRUE`，`consumed_by_link_id` 设为当前链接的 `id`。
        - 将当前链接的 `status` 更新为 `completed`。
        - 向用户返回这两条消息的内容和时间。
    - 如果找到的消息不足两条，可以返回已有的消息，并提示用户等待。
    - 如果一条新消息都没有，返回等待提示。

## 6. 技术选型建议
- **后端**: Node.js (Express.js) - 适合I/O密集型的监控任务。
- **数据库**: sqlite3 - 关系型数据库，保证数据一致性。
- **监控实现**:
    - **动态页面**: `Puppeteer`(index.js中已实现相关逻辑)。
- **任务调度**: `node-cron` 或系统级的 `cron`。
- **前端 (管理后台)**: 原声js
