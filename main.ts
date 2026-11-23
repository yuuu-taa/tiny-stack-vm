// Tiny stack VM (make.fun tiny-stack-vm-01): runs /input i001..i040.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SC = 256, CC = 64, MW = 256, ST = 1_000_000, OC = 65_536;
// Per opcode below: imm bytes, pops, pushes.
const IMM = new Int8Array(256).fill(-1);
const POPS = new Int8Array(256), PUSHES = new Int8Array(256);
function shape(op: number, imm: number, pops: number, pushes: number): void {
  IMM[op] = imm; POPS[op] = pops; PUSHES[op] = pushes;
}
shape(0x01, 1, 0, 1); shape(0x02, 4, 0, 1); shape(0x52, 0, 0, 1);
shape(0x30, 2, 0, 0); shape(0x33, 2, 0, 0); shape(0x34, 0, 0, 0);
shape(0x31, 2, 1, 0); shape(0x32, 2, 1, 0); shape(0x00, 0, 0, 0);
shape(0x03, 0, 1, 0); shape(0x04, 0, 1, 2); shape(0x05, 0, 2, 2);
shape(0x06, 0, 2, 3); shape(0x07, 0, 3, 3); shape(0x17, 0, 1, 1);
shape(0x1b, 0, 1, 1); shape(0x40, 0, 1, 1); shape(0x41, 0, 2, 0);
shape(0x50, 0, 1, 0); shape(0x51, 0, 1, 0); shape(0x53, 0, 1, 0);
for (const op of [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19,
  0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22]) shape(op, 0, 2, 1);

function run(prog: Uint8Array, input: Uint8Array) {
  const size = prog.length;
  const stack = new Int32Array(SC);
  const calls = new Int32Array(CC);
  const mem = new Int32Array(MW);
  const bytes = new Uint8Array(OC);
  let sp = 0, csp = 0, used = 0, inAt = 0, pc = 0, steps = 0;
  const finish = (code: number) => ({ out: bytes.slice(0, used), code });

  for (;;) {
    if (steps >= ST) return finish(10);
    if (pc < 0 || pc >= size) return finish(9);
    const op = prog[pc];
    const imm = IMM[op];
    if (imm < 0) return finish(5);
    if (pc + imm >= size) return finish(9);
    steps += 1;
    if (sp < POPS[op]) return finish(2);
    if (sp - POPS[op] + PUSHES[op] > SC) return finish(3);
    const next = pc + 1 + imm;
    pc = next;

    switch (op) {
      case 0x00: return finish(0);
      case 0x01: stack[sp++] = (prog[next - 1] << 24) >> 24; break;
      case 0x02:
        stack[sp++] = prog[next - 4] | (prog[next - 3] << 8) |
          (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: sp -= 1; break;
      case 0x04: stack[sp] = stack[sp - 1]; sp += 1; break;
      case 0x05: {
        const t = stack[sp - 1];
        stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t;
        break;
      }
      case 0x06: stack[sp] = stack[sp - 2]; sp += 1; break;
      case 0x07: { // ROT
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2]; stack[sp - 2] = stack[sp - 1];
        stack[sp - 1] = a;
        break;
      }
      case 0x17: stack[sp - 1] = -stack[sp - 1] | 0; break;
      case 0x1b: stack[sp - 1] = ~stack[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: {
        const b = stack[sp - 1], a = stack[sp - 2];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return finish(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return finish(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return finish(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return finish(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 1; stack[sp - 1] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let jump = op === 0x30;
        if (!jump) {
          const v = stack[--sp];
          jump = op === 0x31 ? v === 0 : v !== 0;
        }
        if (jump) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp >= CC) return finish(7);
        calls[csp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return finish(8);
        pc = calls[--csp];
        break;
      case 0x40: {
        const addr = stack[sp - 1];
        if (addr < 0 || addr >= MW) return finish(6);
        stack[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = stack[sp - 1];
        if (addr < 0 || addr >= MW) return finish(6);
        mem[addr] = stack[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const text = String(stack[sp - 1]);
        if (used + text.length > OC) return finish(11);
        sp -= 1;
        for (let i = 0; i < text.length; i++) bytes[used++] = text.charCodeAt(i);
        break;
      }
      case 0x51:
        if (used + 1 > OC) return finish(11);
        bytes[used++] = stack[--sp] & 255;
        break;
      case 0x52:
        stack[sp++] = inAt < input.length ? input[inAt++] : -1;
        break;
      case 0x53: return finish(stack[--sp] & 255);
    }
  }
}

function rd(path: string): Uint8Array {
  try { return readFileSync(path); } catch { return new Uint8Array(0); }
}

for (let i = 1; i <= 40; i++) {
  const id = "i" + String(i).padStart(3, "0");
  const { out, code } = run(rd(`/input/${id}/program.bin`), rd(`/input/${id}/input.bin`));
  mkdirSync(`/output/${id}`, { recursive: true });
  writeFileSync(`/output/${id}/stdout.bin`, out);
  writeFileSync(`/output/${id}/exit.txt`, String(code) + "\n");
}
