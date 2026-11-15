/**
 * Zero-Dependency Wikimedia Toolforge MariaDB / MySQL Replica & ToolsDB Client
 *
 * Parses `/data/project/camptools/replica.my.cnf` (or `~/replica.my.cnf`) and executes
 * SQL queries against `commonswiki.analytics.db.svc.wikimedia.cloud` (`commonswiki_p`)
 * and `tools.db.svc.wikimedia.cloud` (`<user>__camptools_p`) using:
 *   1. Pure-Node TCP MySQL/MariaDB Wire Protocol v10 (`net.Socket` + `crypto` SHA-1
 *      `mysql_native_password` handshake & `COM_QUERY` text resultset parser) — works
 *      inside stateless Toolforge buildpack containers without `/usr/bin/mysql` or `Aptfile`.
 *   2. Automatic fallback to `/usr/bin/mysql` CLI binary if present on bastion hosts.
 */

import fs from 'fs';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ReplicaCredentials {
  user: string;
  password: string;
  cnfPath: string;
}

const REPLICA_CNF_CANDIDATES = [
  process.env.REPLICA_MY_CNF || '',
  process.env.TOOL_DATA_DIR ? path.join(process.env.TOOL_DATA_DIR, 'replica.my.cnf') : '',
  '/data/project/camptools/replica.my.cnf',
  path.join(process.env.HOME || '', 'replica.my.cnf')
].filter(Boolean);

export function findReplicaCnf(): string | null {
  for (const p of REPLICA_CNF_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Ignore permission errors
    }
  }
  return null;
}

export function loadReplicaCredentials(customCnfPath?: string | null): ReplicaCredentials | null {
  const cnfPath = customCnfPath || findReplicaCnf();
  if (!cnfPath) return null;
  try {
    const raw = fs.readFileSync(cnfPath, 'utf-8');
    const userMatch = /^\s*user\s*=\s*['"]?([^'"\r\n#]+)['"]?/m.exec(raw);
    const passMatch = /^\s*password\s*=\s*['"]?([^'"\r\n#]+)['"]?/m.exec(raw);
    if (userMatch && userMatch[1] && passMatch && passMatch[1]) {
      return {
        user: userMatch[1].trim(),
        password: passMatch[1].trim(),
        cnfPath
      };
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

export function resolveToolsDbName(customCnfPath?: string | null): string | null {
  if (process.env.CAMPTOOLS_TOOLSDB_NAME) {
    return process.env.CAMPTOOLS_TOOLSDB_NAME;
  }
  const creds = loadReplicaCredentials(customCnfPath);
  if (creds && creds.user) {
    return `${creds.user}__camptools_p`;
  }
  return null;
}

export async function findMysqlBinary(): Promise<string | null> {
  const candidates = [
    process.env.MYSQL_BIN || '',
    'mysql',
    '/usr/bin/mysql',
    '/usr/local/bin/mysql',
    '/layers/heroku_deb-packages/packages/usr/bin/mysql',
    '/layers/heroku_deb-packages/packages/usr/bin/mariadb'
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version']);
      return bin;
    } catch {
      // Ignore not found
    }
  }
  return null;
}

export function escapeSqlLiteral(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Computes MySQL/MariaDB `mysql_native_password` 20-byte scramble response:
 * SHA1(password) XOR SHA1(scramble + SHA1(SHA1(password)))
 */
export function computeMysqlNativePasswordAuth(password: string, scramble: Buffer): Buffer {
  if (!password) return Buffer.alloc(0);
  const stage1 = crypto.createHash('sha1').update(password, 'utf8').digest();
  const stage2 = crypto.createHash('sha1').update(stage1).digest();
  const stage3 = crypto
    .createHash('sha1')
    .update(Buffer.concat([scramble.subarray(0, 20), stage2]))
    .digest();
  const out = Buffer.alloc(20);
  for (let i = 0; i < 20; i++) {
    out[i] = stage1[i] ^ stage3[i];
  }
  return out;
}

function readLengthEncodedInt(buf: Buffer, offset: number): { value: number | null; nextOffset: number } {
  const first = buf[offset];
  if (first === 0xfb) {
    return { value: null, nextOffset: offset + 1 };
  }
  if (first < 0xfb) {
    return { value: first, nextOffset: offset + 1 };
  }
  if (first === 0xfc) {
    return { value: buf.readUInt16LE(offset + 1), nextOffset: offset + 3 };
  }
  if (first === 0xfd) {
    return { value: buf.readUIntLE(offset + 1, 3), nextOffset: offset + 4 };
  }
  return { value: Number(buf.readBigUInt64LE(offset + 1)), nextOffset: offset + 9 };
}

function readLengthEncodedString(buf: Buffer, offset: number): { value: string; nextOffset: number } {
  const { value: len, nextOffset } = readLengthEncodedInt(buf, offset);
  if (len === null || len <= 0) {
    return { value: '', nextOffset };
  }
  const str = buf.subarray(nextOffset, nextOffset + len).toString('utf8');
  return { value: str, nextOffset: nextOffset + len };
}

function buildPacket(seqId: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = seqId & 0xff;
  return Buffer.concat([header, payload]);
}

/**
 * Executes a SQL query over a pure-Node TCP socket using MySQL Wire Protocol v10.
 * Zero external dependencies required.
 */
export function queryViaWireProtocol(options: {
  host: string;
  port?: number;
  socketPath?: string;
  stream?: any;
  user: string;
  password: string;
  database?: string;
  sql: string;
  timeoutMs?: number;
}): Promise<string[][]> {
  const port = options.port || 3306;
  const timeoutMs = options.timeoutMs || 45000;

  return new Promise((resolve, reject) => {
    const socket = options.stream
      ? options.stream
      : options.socketPath
      ? net.createConnection({ path: options.socketPath })
      : net.createConnection({ host: options.host, port });
    let buffer = Buffer.alloc(0);
    let state: 'HANDSHAKE' | 'AUTH_RESULT' | 'QUERY_RESULT' | 'COLUMNS' | 'ROWS' | 'DONE' = 'HANDSHAKE';
    let columnCount = 0;
    let columnsReceived = 0;
    const rows: string[][] = [];
    let settled = false;

    const finish = (err?: Error, result?: string[][]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // Ignore
      }
      if (err) reject(err);
      else resolve(result || []);
    };

    const timer = setTimeout(() => {
      finish(new Error(`MariaDB wire protocol timeout (${timeoutMs}ms) connecting to ${options.host}:${port}`));
    }, timeoutMs);

    socket.on('error', (err: Error) => finish(err));
    socket.on('close', () => {
      if (!settled) {
        finish(new Error(`Connection closed prematurely by ${options.host}:${port} in state ${state}`));
      }
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4 && !settled) {
        const pktLen = buffer.readUIntLE(0, 3);
        const seqId = buffer[3];
        if (buffer.length < 4 + pktLen) break;

        const payload = buffer.subarray(4, 4 + pktLen);
        buffer = buffer.subarray(4 + pktLen);

        if (state === 'HANDSHAKE') {
          if (payload[0] === 0xff) {
            const errMsg = payload.subarray(9).toString('utf8');
            return finish(new Error(`MariaDB handshake error: ${errMsg}`));
          }
          // Parse Initial Handshake Packet (v10)
          let pos = 1; // skip protocol version (10)
          while (pos < payload.length && payload[pos] !== 0x00) pos++;
          pos++; // skip null terminator of server version
          pos += 4; // skip connection id (4 bytes)
          const authPart1 = payload.subarray(pos, pos + 8);
          pos += 8;
          pos += 1; // filler (0x00)
          pos += 2; // capability flags lower 2 bytes
          pos += 1; // character set
          pos += 2; // status flags
          pos += 2; // capability flags upper 2 bytes
          const authPluginDataLen = payload[pos];
          pos += 1;
          pos += 10; // reserved 10 zero bytes
          const part2Len = Math.max(13, (authPluginDataLen || 21) - 8);
          const authPart2 = payload.subarray(pos, pos + part2Len);
          const scramble = Buffer.concat([authPart1, authPart2.subarray(0, 12)]);

          // Client capability flags:
          // CLIENT_LONG_PASSWORD (1) | CLIENT_FOUND_ROWS (2) | CLIENT_LONG_FLAG (4) |
          // CLIENT_CONNECT_WITH_DB (8) | CLIENT_PROTOCOL_41 (512) | CLIENT_SECURE_CONNECTION (32768) |
          // CLIENT_PLUGIN_AUTH (524288) | CLIENT_MULTI_STATEMENTS (65536) | CLIENT_MULTI_RESULTS (131072)
          let clientFlags = 1 | 2 | 4 | 512 | 32768 | 524288 | 65536 | 131072;
          if (options.database) {
            clientFlags |= 8;
          }

          const fixedHeader = Buffer.alloc(32, 0);
          fixedHeader.writeUInt32LE(clientFlags >>> 0, 0);
          fixedHeader.writeUInt32LE(16 * 1024 * 1024, 4); // max packet size 16MB
          fixedHeader[8] = 45; // utf8mb4_general_ci (45)

          const userBuf = Buffer.from(`${options.user}\0`, 'utf8');
          const authResp = computeMysqlNativePasswordAuth(options.password, scramble);
          const authLenBuf = Buffer.from([authResp.length]);
          const dbBuf = options.database ? Buffer.from(`${options.database}\0`, 'utf8') : Buffer.alloc(0);
          const pluginBuf = Buffer.from('mysql_native_password\0', 'utf8');

          const respPayload = Buffer.concat([fixedHeader, userBuf, authLenBuf, authResp, dbBuf, pluginBuf]);
          state = 'AUTH_RESULT';
          socket.write(buildPacket(seqId + 1, respPayload));
        } else if (state === 'AUTH_RESULT') {
          if (payload[0] === 0xff) {
            const errCode = payload.readUInt16LE(1);
            const errMsg = payload.subarray(9).toString('utf8');
            return finish(new Error(`MariaDB auth failed (${errCode}): ${errMsg}`));
          }
          if (payload[0] === 0xfe) {
            // AuthSwitchRequest (e.g. server requests mysql_native_password explicitly)
            let p = 1;
            while (p < payload.length && payload[p] !== 0x00) p++;
            p++;
            const switchScramble = payload.subarray(p, p + 20);
            const switchAuth = computeMysqlNativePasswordAuth(options.password, switchScramble);
            socket.write(buildPacket(seqId + 1, switchAuth));
            continue;
          }
          if (payload[0] === 0x00) {
            // Auth OK -> Send COM_QUERY (0x03)
            const queryPayload = Buffer.concat([Buffer.from([0x03]), Buffer.from(options.sql, 'utf8')]);
            state = 'QUERY_RESULT';
            socket.write(buildPacket(0, queryPayload));
          }
        } else if (state === 'QUERY_RESULT') {
          if (payload[0] === 0xff) {
            const errCode = payload.readUInt16LE(1);
            const errMsg = payload.subarray(9).toString('utf8');
            return finish(new Error(`MariaDB query error (${errCode}): ${errMsg}`));
          }
          if (payload[0] === 0x00) {
            // OK packet (for DDL / INSERT / REPLACE statements with no resultset)
            state = 'DONE';
            return finish(undefined, rows);
          }
          const { value: colCnt } = readLengthEncodedInt(payload, 0);
          columnCount = colCnt || 0;
          columnsReceived = 0;
          state = columnCount > 0 ? 'COLUMNS' : 'DONE';
          if (state === 'DONE') return finish(undefined, rows);
        } else if (state === 'COLUMNS') {
          if (payload[0] === 0xfe && payload.length < 9) {
            // EOF packet after column definitions -> transition to ROWS
            state = 'ROWS';
          } else {
            columnsReceived++;
            // Check if client deprecated EOF (we did not set CLIENT_DEPRECATE_EOF, so an EOF packet follows)
          }
        } else if (state === 'ROWS') {
          if (payload[0] === 0xff) {
            const errCode = payload.readUInt16LE(1);
            const errMsg = payload.subarray(9).toString('utf8');
            return finish(new Error(`MariaDB row error (${errCode}): ${errMsg}`));
          }
          if (payload[0] === 0xfe && payload.length < 9) {
            // EOF packet marking end of resultset rows
            state = 'DONE';
            return finish(undefined, rows);
          }
          const row: string[] = [];
          let offset = 0;
          for (let c = 0; c < columnCount; c++) {
            const { value, nextOffset } = readLengthEncodedString(payload, offset);
            row.push(value);
            offset = nextOffset;
          }
          rows.push(row);
        }
      }
    });
  });
}

/**
 * Executes a SQL query against Wikimedia Wiki Replicas (`commonswiki_p`) or ToolsDB,
 * automatically choosing the pure-Node wire protocol client or the `mysql` CLI binary.
 */
export async function executeMariaDbQuery(options: {
  host?: string;
  port?: number;
  database?: string;
  sql: string;
  cnfPath?: string | null;
  mysqlBin?: string | null;
  timeoutMs?: number;
}): Promise<string[][]> {
  const host = options.host || process.env.WIKI_REPLICA_HOST || 'commonswiki.analytics.db.svc.wikimedia.cloud';
  const port = options.port || parseInt(process.env.WIKI_REPLICA_PORT || '3306', 10);
  const database = options.database !== undefined ? options.database : (process.env.WIKI_REPLICA_DB || 'commonswiki_p');
  const creds = loadReplicaCredentials(options.cnfPath);

  // 1. Prefer pure-Node TCP wire protocol when credentials are available (works inside Toolforge containers without /usr/bin/mysql)
  if (creds) {
    try {
      return await queryViaWireProtocol({
        host,
        port,
        user: creds.user,
        password: creds.password,
        database: database || undefined,
        sql: options.sql,
        timeoutMs: options.timeoutMs || 45000
      });
    } catch (wireErr) {
      // If a CLI binary is available on bastion host, try it as secondary fallback
      const bin = options.mysqlBin !== undefined ? options.mysqlBin : await findMysqlBinary();
      if (!bin) throw wireErr;
    }
  }

  // 2. Fallback to CLI mysql client if present
  const cnfPath = options.cnfPath || creds?.cnfPath || findReplicaCnf();
  const bin = options.mysqlBin !== undefined ? options.mysqlBin : await findMysqlBinary();
  if (!cnfPath || !bin) {
    throw new Error('No replica.my.cnf credentials or mysql client available.');
  }

  const cliArgs = [`--defaults-file=${cnfPath}`, '-h', host, '-P', String(port)];
  if (database) {
    cliArgs.push('-D', database);
  }
  cliArgs.push('--batch', '--raw', '--skip-column-names', '-e', options.sql);

  const { stdout } = await execFileAsync(bin, cliArgs, {
    timeout: options.timeoutMs || 60000,
    maxBuffer: 32 * 1024 * 1024
  });

  if (!stdout || !stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.split('\t'));
}
