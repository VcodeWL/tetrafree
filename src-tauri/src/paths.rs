use std::path::PathBuf;

/// Node's script entrypoint needs ordinary drive/UNC spelling rather than a
/// verbatim prefix. Preserve UNC absoluteness (\\?\UNC\ -> \\).
pub fn clean(p: PathBuf) -> PathBuf {
    let t = p.to_string_lossy().to_string();
    if let Some(unc) = t.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", unc))
    } else {
        PathBuf::from(t.strip_prefix(r"\\?\").unwrap_or(&t))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extended_paths() {
        assert_eq!(
            clean(PathBuf::from(r"\\?\UNC\nas\share\тест")),
            PathBuf::from(r"\\nas\share\тест")
        );
        assert_eq!(
            clean(PathBuf::from(r"\\?\C:\Program Files\TetraFree")),
            PathBuf::from(r"C:\Program Files\TetraFree")
        );
        assert_eq!(
            clean(PathBuf::from(r"\\nas\share\test")),
            PathBuf::from(r"\\nas\share\test")
        );
        assert_eq!(
            clean(PathBuf::from("relative/path")),
            PathBuf::from("relative/path")
        );
    }
}
