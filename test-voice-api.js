// 测试语音API接口的脚本
// 使用方法：node test-voice-api.js "你好，这是一条测试消息"

const http = require('http');

// 从命令行参数获取消息文本，如果没有提供则使用默认消息
const message = process.argv[2] || '你好，这是通过Voice API发送的测试消息！';

const postData = message;

const options = {
  hostname: '127.0.0.1',
  port: 8765,
  path: '/voice',
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(postData, 'utf8')
  }
};

console.log('正在发送消息到 Cherry Studio...');
console.log('消息内容:', message);
console.log('目标地址: http://127.0.0.1:8765/voice');

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  console.log(`响应头:`, res.headers);

  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('响应内容:', responseData);
    try {
      const jsonResponse = JSON.parse(responseData);
      if (jsonResponse.success) {
        console.log('✅ 消息发送成功！');
      } else {
        console.log('❌ 消息发送失败:', jsonResponse.error);
      }
    } catch (e) {
      console.log('响应不是有效的JSON格式');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ 请求失败:', e.message);
  console.log('请确保 Cherry Studio 正在运行并且Voice API服务器已启动');
});

req.write(postData);
req.end();