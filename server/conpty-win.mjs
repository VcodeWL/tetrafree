/* Windows: помощник ConPTY без Python. Маленькая программа на C# собирается один раз штатным компилятором
   .NET Framework 4 (csc.exe есть в каждой Windows 10/11) и кладётся в %LOCALAPPDATA%\TetraFree\bin.
   Протокол тот же, что у Linux-помощника: ввод — в stdin, вывод — из stdout, смена размера приходит в потоке ввода
   строкой "\0TFRSZ <cols> <rows>\n". Аргументы: cols rows командная_строка. */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CONPTY_CS = String.raw`
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class TfConPty
{
    [StructLayout(LayoutKind.Sequential)]
    struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out IntPtr hRead, out IntPtr hWrite, IntPtr attrs, uint size);
    [DllImport("kernel32.dll")]
    static extern int CreatePseudoConsole(COORD size, IntPtr hInput, IntPtr hOutput, uint flags, out IntPtr phPC);
    [DllImport("kernel32.dll")]
    static extern int ResizePseudoConsole(IntPtr hPC, COORD size);
    [DllImport("kernel32.dll")]
    static extern void ClosePseudoConsole(IntPtr hPC);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr cb, IntPtr prev, IntPtr ret);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadFile(IntPtr h, byte[] buf, int n, out int read, IntPtr ov);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool WriteFile(IntPtr h, byte[] buf, int n, out int written, IntPtr ov);
    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")]
    static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")]
    static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    static IntPtr hpc, inW, outR, hProc;
    static Thread reader;
    static Stream stdout;

    static COORD Size(int c, int r)
    {
        COORD k = new COORD();
        k.X = (short)c;
        k.Y = (short)r;
        return k;
    }

    static int Main(string[] args)
    {
        if (args.Length < 3) return 1;
        int cols = int.Parse(args[0]);
        int rows = int.Parse(args[1]);
        string cmdline = args[2];

        IntPtr inR, outW;
        if (!CreatePipe(out inR, out inW, IntPtr.Zero, 0) || !CreatePipe(out outR, out outW, IntPtr.Zero, 0)) return 2;
        int hr = CreatePseudoConsole(Size(cols, rows), inR, outW, 0, out hpc);
        if (hr != 0)
        {
            Console.Error.WriteLine("CreatePseudoConsole: " + hr);
            return 3;
        }

        IntPtr listSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
        IntPtr list = Marshal.AllocHGlobal(listSize);
        if (!InitializeProcThreadAttributeList(list, 1, 0, ref listSize)) return 4;
        /* PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016; значение — сам дескриптор HPCON */
        if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020016, hpc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) return 5;

        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        si.lpAttributeList = list;
        PROCESS_INFORMATION pi;
        StringBuilder cl = new StringBuilder(cmdline, Math.Max(cmdline.Length + 1, 32768));
        /* EXTENDED_STARTUPINFO_PRESENT = 0x00080000 */
        if (!CreateProcessW(null, cl, IntPtr.Zero, IntPtr.Zero, false, 0x00080000, IntPtr.Zero, null, ref si, out pi))
        {
            Console.Error.WriteLine("CreateProcessW: " + Marshal.GetLastWin32Error());
            return 6;
        }
        hProc = pi.hProcess;
        CloseHandle(inR);
        CloseHandle(outW);

        stdout = Console.OpenStandardOutput();
        reader = new Thread(Pump);
        reader.IsBackground = true;
        reader.Start();

        Thread waiter = new Thread(WaitExit);
        waiter.IsBackground = true;
        waiter.Start();

        Stream stdin = Console.OpenStandardInput();
        byte[] marker = Encoding.ASCII.GetBytes("\0TFRSZ ");
        List<byte> pending = new List<byte>();
        byte[] buf = new byte[65536];
        while (true)
        {
            int n = stdin.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            for (int i = 0; i < n; i++) pending.Add(buf[i]);
            Drain(pending, marker);
        }
        TerminateProcess(hProc, 1);
        Environment.Exit(1);
        return 1;
    }

    /* отправляет накопленный ввод в консоль; строки "\0TFRSZ c r\n" превращает в смену размера */
    static void Drain(List<byte> p, byte[] marker)
    {
        while (p.Count > 0)
        {
            int at = IndexOf(p, marker);
            if (at < 0)
            {
                /* хвост может быть началом маркера — оставляем его до следующего чтения */
                int keep = 0;
                for (int k = Math.Min(marker.Length - 1, p.Count); k > 0; k--)
                {
                    bool ok = true;
                    for (int j = 0; j < k; j++)
                        if (p[p.Count - k + j] != marker[j]) { ok = false; break; }
                    if (ok) { keep = k; break; }
                }
                Send(p.GetRange(0, p.Count - keep).ToArray());
                p.RemoveRange(0, p.Count - keep);
                return;
            }
            if (at > 0)
            {
                Send(p.GetRange(0, at).ToArray());
                p.RemoveRange(0, at);
            }
            int nl = p.IndexOf((byte)10);
            if (nl < 0) return; /* строка размера ещё не пришла целиком */
            string line = Encoding.ASCII.GetString(p.GetRange(marker.Length, nl - marker.Length).ToArray());
            p.RemoveRange(0, nl + 1);
            string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            int c, r;
            if (parts.Length == 2 && int.TryParse(parts[0], out c) && int.TryParse(parts[1], out r))
                ResizePseudoConsole(hpc, Size(c, r));
        }
    }

    static int IndexOf(List<byte> p, byte[] m)
    {
        for (int i = 0; i + m.Length <= p.Count; i++)
        {
            bool ok = true;
            for (int j = 0; j < m.Length; j++)
                if (p[i + j] != m[j]) { ok = false; break; }
            if (ok) return i;
        }
        return -1;
    }

    static void Send(byte[] b)
    {
        int off = 0;
        while (off < b.Length)
        {
            byte[] chunk = b;
            if (off > 0)
            {
                chunk = new byte[b.Length - off];
                Array.Copy(b, off, chunk, 0, chunk.Length);
            }
            int w;
            if (!WriteFile(inW, chunk, chunk.Length, out w, IntPtr.Zero) || w <= 0) return;
            off += w;
        }
    }

    static void Pump()
    {
        byte[] buf = new byte[65536];
        int n;
        while (ReadFile(outR, buf, buf.Length, out n, IntPtr.Zero) && n > 0)
        {
            stdout.Write(buf, 0, n);
            stdout.Flush();
        }
    }

    static void WaitExit()
    {
        WaitForSingleObject(hProc, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(hProc, out code);
        ClosePseudoConsole(hpc);
        reader.Join(2000);
        stdout.Flush();
        Environment.Exit((int)(code & 0xFF));
    }
}
`

const CSC = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]

/** ConPTY есть в Windows 10 1809 (сборка 17763) и новее */
export const conPtySupported = (release = os.release()) => {
  const build = parseInt(String(release).split('.')[2] || '0', 10)
  return build >= 17763
}

/** путь к собранному помощнику; при первом запуске компилирует. Бросает ошибку с понятным текстом. */
export function ensureConPty() {
  if (!conPtySupported()) throw new Error('нужна Windows 10 версии 1809 или новее')
  const csc = CSC.find((p) => fs.existsSync(p))
  if (!csc) throw new Error('не найден csc.exe (.NET Framework 4)')
  const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'TetraFree', 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const tag = crypto.createHash('sha1').update(CONPTY_CS).digest('hex').slice(0, 10)
  const exe = path.join(dir, `conpty-${tag}.exe`)
  if (fs.existsSync(exe)) return exe
  const src = path.join(dir, `conpty-${tag}.cs`)
  fs.writeFileSync(src, CONPTY_CS, 'utf8')
  const tmpExe = exe + '.tmp.exe'
  try {
    execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${tmpExe}`, src], {
      windowsHide: true,
      timeout: 60000,
      stdio: 'pipe',
    })
  } catch (e) {
    const out = String(e.stdout || e.stderr || e.message)
      .split('\n')
      .slice(0, 4)
      .join(' ')
      .trim()
    throw new Error('не удалось собрать помощник терминала: ' + out)
  }
  fs.renameSync(tmpExe, exe)
  return exe
}
