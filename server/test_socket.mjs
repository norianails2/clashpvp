import { io } from 'socket.io-client';

async function test() {
  // Test 1: dev user auth
  const s1 = io('http://localhost:3001', {
    query: { testUser: 'debug1' },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise(r => s1.on('connect', r));
  console.log('✅ s1 connected:', s1.id);

  // Check balance
  s1.emit('balance:get', {}, (res) => {
    console.log('💰 balance:', JSON.stringify(res));
  });

  // Test RPS create room
  s1.emit('rps:create_room', { bet: 100 }, (res) => {
    console.log('🎮 rps:create_room:', JSON.stringify(res));
  });

  // Test lobby
  s1.emit('lobby:get_rooms', { gameType: 'rps' }, (res) => {
    console.log('📋 lobby rooms:', JSON.stringify(res).slice(0, 300));
  });

  // Test Crash
  s1.emit('crash:join', {}, (res) => {
    console.log('💥 crash:join');
  });
  s1.emit('crash:get_state', {}, (res) => {
    console.log('💥 crash state:', JSON.stringify(res));
  });

  await new Promise(r => setTimeout(r, 2000));

  // Test 2: second user for PvP
  const s2 = io('http://localhost:3001', {
    query: { testUser: 'debug2' },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise(r => s2.on('connect', r));
  console.log('✅ s2 connected:', s2.id);

  s2.emit('lobby:get_rooms', { gameType: 'rps' }, (res) => {
    console.log('📋 s2 lobby rooms:', JSON.stringify(res).slice(0, 300));
  });

  await new Promise(r => setTimeout(r, 1000));

  s1.close();
  s2.close();
  console.log('🏁 done');
  process.exit(0);
}

test().catch(err => { console.error('❌', err); process.exit(1); });
