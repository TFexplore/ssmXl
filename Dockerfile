# 使用官方的Node.js LTS版本作为基础镜像
FROM node:lts-alpine

# 安装 Chromium 及其依赖
# 参考 Puppeteer 在 Alpine Linux 上的安装指南
RUN apk add --no-cache chromium nss freetype-dev harfbuzz-dev openjdk17-jre-headless \
    ttf-freefont fontconfig \
    # 确保 Chromium 能够找到这些库
    && ln -s /usr/bin/chromium-browser /usr/bin/google-chrome \
    && rm -rf /var/cache/apk/*

# 设置工作目录
WORKDIR /app

# 创建用于持久化SQLite数据库的目录
RUN mkdir -p /app/data

# 声明一个卷，用于持久化SQLite数据库
VOLUME /app/data

# 确保 /app/data 目录对 'node' 用户可写
RUN chown -R node:node /app/data \
    && chmod -R 775 /app/data

# 设置 Puppeteer 可执行文件路径
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 复制 package.json 和 package-lock.json 并安装依赖
# 使用COPY --chown=node:node 可以确保文件权限正确，避免后续运行问题
COPY --chown=node:node package*.json ./

# 安装项目依赖
RUN npm install --production
RUN npm install pm2 -g

# 复制所有项目文件到工作目录
COPY --chown=node:node . .

# 确保整个 /app 目录及其内容对 'node' 用户可写
RUN chown -R node:node /app \
    && chmod -R 775 /app

# 暴露应用运行的端口
EXPOSE 3000

# 切换到非root用户，提高安全性
USER node

# 定义启动应用的命令，使用 pm2-runtime
CMD ["pm2-runtime", "src/server.js"]

#docker run -p 3000:3000 -v /opt/sms:/app/data smsxl-app
