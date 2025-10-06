// 通用请求头
const BASE_HEADERS = {
  "accept": "*/*",
  "accept-language": "zh-cn",
  "content-type": "application/json",
  "pragma": "no-cache",
  "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Microsoft Edge\";v=\"140\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-client-version": "1.1.6",
  "x-device-model": "chrome%2F140.0.0.0",
  "x-device-name": "PC-Chrome",
  "x-net-work-type": "NONE",
  "x-os-version": "Win32",
  "x-platform-version": "1",
  "x-protocol-version": "301",
  "x-provider-name": "NONE",
  "x-sdk-version": "8.1.4",
  "Referer": "https://i.xunlei.com/"
};

// 用于存储动态生成的设备信息，确保在initCaptcha和signIn之间保持一致
let dynamicHeaders = {};

/**
 * 生成指定长度的随机十六进制字符串
 * @param {number} length 字符串长度
 * @returns {string} 随机十六进制字符串
 */
function generateRandomHex(length) {
  return [...Array(length)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * 生成随机的 client_id
 * @param {number} length 长度
 * @returns {string} 随机字符串
 */
function generateClientId(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 刷新动态请求头，生成新的设备ID、签名和客户端ID
 * 每次登录尝试前调用，以避免因设备指纹重复被风控
 */
function refreshDynamicHeaders() {
  const deviceId = generateRandomHex(32);
  const clientId = generateClientId(16); // 'XW5SkOhLDjnOZP7J' is 16 chars long
  // 签名结构是基于观察得出的猜测
  // 格式: wdi10.[deviceId][static_part]
  // 这种方式主要是为了避免设备指纹被识别为重复，如果服务器对签名有严格校验，可能会失败
  const staticSignaturePart = "9b7b848b1b3b888173b28bb3b727bb9a";
  const deviceSign = `wdi10.${deviceId}${staticSignaturePart}`;
  dynamicHeaders = {
    "x-device-id": deviceId,
    "x-device-sign": deviceSign,
    "x-client-id": "XW5SkOhLDjnOZP7J",//"XW5SkOhLDjnOZP7J",
  };
}

// 脚本加载时初始化一次
refreshDynamicHeaders();

/**
 * 初始化验证码，获取x-captcha-token
 * @param {string} phoneNumber 手机号码
 * @returns {Promise<string|null>} 成功则返回captcha_token，否则返回null
 */
export async function initCaptcha(phoneNumber) {
  refreshDynamicHeaders(); // 每次调用时都生成新的设备信息，以避免被风控
  const url = "/api/proxy/?targetApi=v1/shield/captcha/init"; // 将目标API路径作为URL参数传入
  const body = JSON.stringify({
    "client_id": dynamicHeaders["x-client-id"], // 使用动态生成的client_id
    "action": "POST:/v1/auth/signin",
    "device_id": dynamicHeaders["x-device-id"], // 使用动态生成的device_id
    "meta": {"phone_number": phoneNumber}
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...BASE_HEADERS, ...dynamicHeaders },
      body: body,
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("初始化验证码失败:", errorData);
      return null;
    }

    const data = await response.json();
    // 用户提供的示例返回结构是 {"captcha_token": "...", "expires_in": 300}
    return data.captcha_token || null;
  } catch (error) {
    console.error("请求初始化验证码时发生错误:", error);
    return null;
  }
}

/**
 * 验证用户账号和密码
 * @param {string} username 用户名
 * @param {string} password 密码
 * @param {string} captchaToken 验证码token，通过initCaptcha获取
 * @returns {Promise<object|null>} 成功则返回登录结果，否则返回null
 */
export async function signIn(username, password, captchaToken) {
  const url = "/api/proxy/?targetApi=v1/auth/signin"; // 将目标API路径作为URL参数传入
  const headers = {
    ...BASE_HEADERS,
    ...dynamicHeaders, // 使用与initCaptcha相同的动态设备信息
    "x-captcha-token": captchaToken, // 传入从initCaptcha获取的token
  };
  const body = JSON.stringify({
    username: username,
    password: password,
    client_id: dynamicHeaders["x-client-id"], // 使用动态生成的client_id
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("登录失败:", errorData);
      // 根据用户提供的示例错误结构解析错误信息
      // 如果error_code是4012，表示账号已被冻结或无效
      // 如果error_code是4022，表示账号有效
      return errorData; // 返回错误信息，方便调用方处理
    }

    const data = await response.json();
    return data; // 返回登录成功的数据
  } catch (error) {
    console.error("请求登录时发生错误:", error);
    return null;
  }
}
