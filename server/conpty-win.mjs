/* Windows: помощник ConPTY без Python. Маленькая программа на C# собирается один раз штатным компилятором
   .NET Framework 4 (csc.exe есть в каждой Windows 10/11) и кладётся в %LOCALAPPDATA%\TetraFree\bin.
   Протокол тот же, что у Linux-помощника: ввод — в stdin, вывод — из stdout, смена размера приходит в потоке ввода
   строкой "\0TFRSZ <cols> <rows>\n". Аргументы: cols rows командная_строка. */
import { execFile } from 'node:child_process'
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

    [StructLayout(LayoutKind.Sequential)]
    struct JOB_BASIC_LIMIT {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOB_LIMIT {
        public JOB_BASIC_LIMIT Basic;
        public IO_COUNTERS Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int info, ref JOB_LIMIT limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);

    static IntPtr job;
    static IntPtr hpc, inW, outR, hProc;
    static Thread reader;
    static Stream stdout;
    static ManualResetEvent ready = new ManualResetEvent(false);
    static bool dbg = Environment.GetEnvironmentVariable("TF_PTY_DEBUG") == "1";
    static void Log(string m) { if (dbg) { Console.Error.WriteLine("[conpty] " + m); Console.Error.Flush(); } }

    static COORD Size(int c, int r)
    {
        COORD k = new COORD();
        k.X = (short)c;
        k.Y = (short)r;
        return k;
    }

    static int Main(string[] args)
    {
        int cols, rows;
        if (args.Length < 3 || !int.TryParse(args[0], out cols) || !int.TryParse(args[1], out rows)
            || cols < 20 || cols > 500 || rows < 5 || rows > 200)
        { Console.Error.WriteLine("Invalid terminal dimensions (integer cols 20..500, rows 5..200 required)"); return 1; }
        job = CreateJobObjectW(IntPtr.Zero, null);
        JOB_LIMIT limits = new JOB_LIMIT();
        limits.Basic.Flags = 0x00002000; /* KILL_ON_JOB_CLOSE; no BREAKAWAY */
        if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JOB_LIMIT))))
        { Console.Error.WriteLine("Job setup: " + Marshal.GetLastWin32Error()); return 7; }
        string cmdline = args[2];

        IntPtr inR, outW;
        if (!CreatePipe(out inR, out inW, IntPtr.Zero, 0) || !CreatePipe(out outR, out outW, IntPtr.Zero, 0))
        { Console.Error.WriteLine("CreatePipe: " + Marshal.GetLastWin32Error()); return 2; }
        uint pcFlags = 0;
        uint.TryParse(Environment.GetEnvironmentVariable("TF_PTY_FLAGS") ?? "0", out pcFlags);
        int hr = CreatePseudoConsole(Size(cols, rows), inR, outW, pcFlags, out hpc);
        if (hr != 0)
        {
            Console.Error.WriteLine("CreatePseudoConsole: " + hr);
            return 3;
        }

        IntPtr listSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
        IntPtr list = Marshal.AllocHGlobal(listSize);
        if (!InitializeProcThreadAttributeList(list, 1, 0, ref listSize))
        { Console.Error.WriteLine("InitializeProcThreadAttributeList: " + Marshal.GetLastWin32Error()); return 4; }
        /* PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016; значение — сам дескриптор HPCON */
        if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020016, hpc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
        { Console.Error.WriteLine("UpdateProcThreadAttribute: " + Marshal.GetLastWin32Error()); return 5; }

        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        /* STARTF_USESTDHANDLES с пустыми дескрипторами: оболочка берёт ввод-вывод только у псевдоконсоли, а не наследует каналы самого помощника (так делают node-pty и WezTerm) */
        si.StartupInfo.dwFlags = 0x00000100;
        si.StartupInfo.hStdInput = IntPtr.Zero;
        si.StartupInfo.hStdOutput = IntPtr.Zero;
        si.StartupInfo.hStdError = IntPtr.Zero;
        si.lpAttributeList = list;
        PROCESS_INFORMATION pi;
        StringBuilder cl = new StringBuilder(cmdline, Math.Max(cmdline.Length + 1, 32768));
        /* EXTENDED_STARTUPINFO_PRESENT = 0x00080000 */
        if (!CreateProcessW(null, cl, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x00000004, IntPtr.Zero, null, ref si, out pi))
        {
            Console.Error.WriteLine("CreateProcessW: " + Marshal.GetLastWin32Error());
            return 6;
        }
        hProc = pi.hProcess;
        if (!AssignProcessToJobObject(job, hProc) || ResumeThread(pi.hThread) == 0xFFFFFFFF)
        {
            Console.Error.WriteLine("Job assignment/resume: " + Marshal.GetLastWin32Error());
            TerminateProcess(hProc, 7);
            CloseHandle(pi.hThread);
            return 7;
        }
        CloseHandle(pi.hThread);
        DeleteProcThreadAttributeList(list);
        Marshal.FreeHGlobal(list);
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
            Log("stdin read " + n);
            if (n <= 0) break;
            for (int i = 0; i < n; i++) pending.Add(buf[i]);
            Drain(pending, marker);
        }
        TerminateJobObject(job, 1);
        WaitForSingleObject(hProc, 2000);
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
            if (nl < 0)
            {
                if (p.Count > 128) { Console.Error.WriteLine("Oversized resize record"); p.Clear(); }
                return; /* fragmented control record, bounded to 128 bytes */
            }
            string line = Encoding.ASCII.GetString(p.GetRange(marker.Length, nl - marker.Length).ToArray());
            p.RemoveRange(0, nl + 1);
            string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            int c, r;
            if (parts.Length == 2 && int.TryParse(parts[0], out c) && int.TryParse(parts[1], out r)
                && c >= 20 && c <= 500 && r >= 5 && r <= 200)
            {
                int hr = ResizePseudoConsole(hpc, Size(c, r));
                if (hr != 0) Console.Error.WriteLine("ResizePseudoConsole: " + hr);
            }
            else Console.Error.WriteLine("Invalid resize dimensions");
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
        /* ввод, пришедший раньше первого вывода оболочки, ConPTY на новых Windows теряет — ждём, пока оболочка заговорит (но не дольше 3 с) */
        ready.WaitOne(3000);
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
            bool okw = WriteFile(inW, chunk, chunk.Length, out w, IntPtr.Zero);
            Log("WriteFile ok=" + okw + " n=" + chunk.Length + " written=" + w + " err=" + Marshal.GetLastWin32Error());
            if (!okw || w <= 0) return;
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
            Log("pty out " + n);
            ready.Set();
        }
    }

    static void WaitExit()
    {
        WaitForSingleObject(hProc, 0xFFFFFFFF);
        uint code;
        if (!GetExitCodeProcess(hProc, out code)) code = 1;
        Log("child exited " + code);
        ClosePseudoConsole(hpc);
        reader.Join(2000);
        stdout.Flush();
        TerminateJobObject(job, code); /* reap descendants even when shell exited normally */
        CloseHandle(hProc);
        Environment.Exit(unchecked((int)code));
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

/** путь к собранному помощнику; при первом запуске компилирует (асинхронно, сервер не блокируется). Бросает ошибку с понятным текстом. */
let building = null
export function ensureConPty() {
  /* вызовы вперемешку (сервер и проверка) не должны запускать две компиляции в один файл */
  return (building ??= build().finally(() => (building = null)))
}

async function build() {
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
  const tmpExe = `${exe}.${process.pid}.tmp.exe`
  try {
    await new Promise((resolve, reject) =>
      execFile(
        csc,
        ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${tmpExe}`, src],
        { windowsHide: true, timeout: 60000 },
        (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve()),
      ),
    )
  } catch (e) {
    const out = String(e.stdout || e.stderr || e.message)
      .split('\n')
      .slice(0, 4)
      .join(' ')
      .trim()
    throw new Error('не удалось собрать помощник терминала: ' + out)
  }
  try {
    fs.renameSync(tmpExe, exe)
  } catch (e) {
    /* антивирус сканирует свежий .exe и держит его открытым — если готовый файл уже есть, используем его */
    if (!fs.existsSync(exe)) {
      try {
        fs.copyFileSync(tmpExe, exe)
      } catch {
        throw new Error('не удалось сохранить помощник терминала: ' + e.message)
      }
    }
    try {
      fs.unlinkSync(tmpExe)
    } catch {
      /* останется во временной папке */
    }
  }
  return exe
}
