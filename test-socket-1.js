// test-socket-1.js
const { io } = require('socket.io-client');

const token =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjYmZhZDM5Ni02ZDU4LTQ5OTMtOTE0Zi0xNjg5OWM2NzY5NWUiLCJlbWFpbCI6IjFAZXRoZXJlYWwuZW1haWwiLCJpYXQiOjE3ODc5OTM1MjIsImV4cCI6MTc4Nzk5NDQyMn0.bJdg72HRPTaWvirNwIoRa0f8oTubme06jR6DX0OwJYQ';

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
