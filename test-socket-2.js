// test-socket-2.js
const { io } = require('socket.io-client');

const token =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNmZlZDM4My0xMGQ0LTQxOGEtYjk2OC02ZTFiNzhjMWUwZjgiLCJlbWFpbCI6IjJAZXRoZXJlYWwuZW1haWwiLCJpYXQiOjE3ODc5OTM1NDksImV4cCI6MTc4Nzk5NDQ0OX0.spfPZVkj2zaSWZCMS5y4rB5XM9CHZO98mnCo8LYccu0';

const socket = io('http://localhost:3002', {
  auth: { token },
});

socket.on('connect', () => {
  console.log('✅ Подключено! Socket ID:', socket.id);
});

socket.on('connect_error', (err) => {
  console.log('❌ Ошибка подключения:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Отключено:', reason);
});

socket.on('message', (data) => {
  console.log('📩 Новое сообщение:', data);
});

socket.on('read', (data) => {
  console.log('✅ Прочитано:', data);
});

socket.on('reaction', (data) => {
  console.log('😀 Реакция:', data);
});
