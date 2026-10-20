//! Windows process-tree ownership. Assign a SUSPENDED child before it can create
//! descendants; fail closed if assignment/resume fails (no unowned backend).
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

pub struct Job(HANDLE);
// This uniquely-owned kernel handle is not a pointer into Rust memory. Operations
// are serialized by ServerChild's mutex; Drop closes it exactly once.
unsafe impl Send for Job {}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
impl Job {
    pub fn assign(child: &Child) -> Result<Self, String> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(job)
        }
    }
    pub fn terminate(&self) -> Result<(), String> {
        if unsafe { TerminateJobObject(self.0, 1) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
}

pub fn resume(child: &Child) -> Result<(), String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut more = Thread32First(snapshot, &mut entry);
        let mut result = Err("не найден первичный поток suspended сервера".to_string());
        while more != 0 {
            if entry.th32OwnerProcessID == child.id() {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if thread.is_null() {
                    result = Err(std::io::Error::last_os_error().to_string());
                } else {
                    let previous = ResumeThread(thread);
                    let error = std::io::Error::last_os_error();
                    CloseHandle(thread);
                    result = if previous == u32::MAX {
                        Err(error.to_string())
                    } else if previous != 1 {
                        Err(format!("unexpected suspended thread count: {previous}"))
                    } else {
                        Ok(())
                    };
                }
                break;
            }
            more = Thread32Next(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    #[test]
    fn closing_job_reaps_root_and_live_descendant() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("tf-job-{}-{token}.pid", std::process::id()));
        let script = r#"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000)"#;
        let mut child = Command::new("node.exe")
            .args(["-e", script])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000 | 0x0000_0004)
            .spawn()
            .unwrap();
        let job = match Job::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("job assignment: {error}");
            }
        };
        resume(&child).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !path.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let pid: u32 = std::fs::read_to_string(&path)
            .expect("descendant PID not produced")
            .parse()
            .unwrap();
        let _ = std::fs::remove_file(path);
        // Keep the process object open so PID reuse cannot give a false pass.
        let descendant = unsafe { OpenProcess(0x0010_0000, 0, pid) }; // SYNCHRONIZE
        assert!(!descendant.is_null(), "cannot observe live descendant");
        assert_eq!(
            unsafe { WaitForSingleObject(descendant, 0) },
            258,
            "descendant already exited"
        );
        drop(job); // exercises KILL_ON_JOB_CLOSE, not just TerminateProcess(root)
        let descendant_wait = unsafe { WaitForSingleObject(descendant, 5000) };
        unsafe {
            CloseHandle(descendant);
        }
        assert_eq!(descendant_wait, 0, "descendant survived job close");
        assert_eq!(
            unsafe { WaitForSingleObject(child.as_raw_handle() as HANDLE, 5000) },
            0,
            "root survived job close"
        );
        let _ = child.wait();
    }
}
