module.exports = {
  apps : [{
    name: "smsXl-instance-1",
    script: "src/server.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "development",
      PORT: 3101,
      MYSQL_HOST: "154.219.99.59",
      MYSQL_USER: "root",
      MYSQL_PASSWORD: "mysql_H7ccXy",
      MYSQL_DATABASE: "smsxl_db",
      MYSQL_PORT: 3306
    }
  }, {
    name: "smsXl-instance-2",
    script: "src/server.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "development",
      PORT: 3102,
      MYSQL_HOST: "154.219.99.59",
      MYSQL_USER: "root",
      MYSQL_PASSWORD: "mysql_H7ccXy",
      MYSQL_DATABASE: "smsxl_db2",
      MYSQL_PORT: 3306
    }
  }, {
    name: "smsXl-instance-3",
    script: "src/server.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "development",
      PORT: 3103,
      MYSQL_HOST: "154.219.99.59",
      MYSQL_USER: "root",
      MYSQL_PASSWORD: "mysql_H7ccXy",
      MYSQL_DATABASE: "smsxl_db3",
      MYSQL_PORT: 3306
    }
  }]
};
