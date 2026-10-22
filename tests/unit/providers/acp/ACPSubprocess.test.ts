import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

jest.mock('cross-spawn', () => jest.fn());

import spawn from 'cross-spawn';

import { ACPSubprocess } from '@/providers/acp/ACPSubprocess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.exitCode = null;
  proc.killed = false;
  proc.pid = 12345;
  proc.kill = jest.fn(() => true);
  return proc;
}

describe('ACPSubprocess', () => {
  const originalPlatform = process.platform;
  let proc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('spawns ACP runtimes directly on non-Windows commands', () => {
    const subprocess = new ACPSubprocess({
      args: ['acp', '--cwd=/vault'],
      command: '/opt/opencode/bin/opencode',
      cwd: '/vault',
      env: { PATH: '/usr/bin' },
    });

    subprocess.start();

    expect(mockSpawn).toHaveBeenCalledWith('/opt/opencode/bin/opencode', ['acp', '--cwd=/vault'], expect.objectContaining({
      cwd: '/vault',
      stdio: 'pipe',
      windowsHide: true,
    }));
  });

  it('passes Windows .cmd shims to cross-spawn', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const subprocess = new ACPSubprocess({
      args: ['acp', '--cwd=C:\\Vault'],
      command: 'C:\\Users\\R&D\\AppData\\Roaming\\npm\\opencode.cmd',
      cwd: 'C:\\Vault',
      env: { PATH: 'C:\\Windows\\System32' },
    });

    subprocess.start();

    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\Users\\R&D\\AppData\\Roaming\\npm\\opencode.cmd',
      ['acp', '--cwd=C:\\Vault'],
      expect.objectContaining({
        cwd: 'C:\\Vault',
        windowsHide: true,
      }),
    );
  });

  it('retains split UTF-8 diagnostics through the public stderr snapshot', () => {
    const subprocess = new ACPSubprocess({
      args: ['acp', '--cwd=/vault'],
      command: '/opt/opencode/bin/opencode',
      cwd: '/vault',
      env: { PATH: '/usr/bin' },
    });
    subprocess.start();

    proc.stderr.emit('data', Buffer.from([0xe4]));
    expect(subprocess.getStderrSnapshot()).toBe('');
    proc.stderr.emit('data', Buffer.from([0xb8, 0xad, 0xf0, 0x9f]));
    expect(subprocess.getStderrSnapshot()).toBe('\u4e2d');
    proc.stderr.emit('data', Buffer.from([0x9a, 0x80]));

    expect(subprocess.getStderrSnapshot()).toBe('\u4e2d\ud83d\ude80');
    expect(subprocess.stderr).toBe(proc.stderr);
    proc.emit('close', 0, null);
    expect(subprocess.getStderrSnapshot()).toBe('\u4e2d\ud83d\ude80');
  });

  it('kills the process tree when shutting down Windows .cmd shims', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const subprocess = new ACPSubprocess({
      args: ['acp', '--cwd=C:\\Vault'],
      command: 'C:\\Users\\R&D\\AppData\\Roaming\\npm\\opencode.cmd',
      cwd: 'C:\\Vault',
      env: { PATH: 'C:\\Windows\\System32' },
    });
    subprocess.start();

    const shutdown = subprocess.shutdown();

    expect(mockSpawn).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', '12345', '/t', '/f'],
      expect.objectContaining({
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
    expect(proc.kill).not.toHaveBeenCalled();

    proc.exitCode = 0;
    proc.emit('exit', 0, null);
    await shutdown;
  });
});
