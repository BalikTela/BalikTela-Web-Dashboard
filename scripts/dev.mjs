import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev:api'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev:web'], { stdio: 'inherit' }),
];

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    stop();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

