use tauri::Manager;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::fs;
use std::io::{BufReader, Cursor, Read};
use std::path::{Path, PathBuf};
use std::collections::BTreeMap;
use zip::ZipArchive;
use futures_util::StreamExt;
use rayon::prelude::*;

#[derive(Deserialize)]
struct ManifestEntry {
    path: String,
    url: String,
    sha256: String,
}

#[derive(Deserialize)]
struct Manifest {
    files: Vec<ManifestEntry>,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    file: String,
    downloaded_mb: String,
    total_mb: String,
    percentage: u32,
}





fn sha256_file_stream(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Serialize, Deserialize, Clone)]
struct FileEntry {
    size: u64,
    hash: String,
}

fn archive_manifest_path(root_dir: &Path, archive_name: &str) -> PathBuf {
    root_dir.join(".manifests").join(format!("{}_manifest.json", archive_name))
}

fn load_archive_manifest(root_dir: &Path, archive_name: &str) -> BTreeMap<String, FileEntry> {
    fs::read_to_string(archive_manifest_path(root_dir, archive_name))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_archive_manifest(
    root_dir: &Path,
    archive_name: &str,
    manifest: &BTreeMap<String, FileEntry>,
) -> Result<(), String> {
    let dir = root_dir.join(".manifests");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(archive_manifest_path(root_dir, archive_name), json).map_err(|e| e.to_string())
}

fn extract_zip_from_memory(
    bytes: &[u8],
    root_dir: &Path,
    target_dir: &Path,
    archive_name: &str,
) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Arhivă ZIP nevalidă: {}", e))?;

    let mut manifest = load_archive_manifest(root_dir, archive_name);
    let mut changed = 0usize;

    let strip_prefix = format!("{}/", archive_name);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;

        if file.name().ends_with('/') {
            continue;
        }

        let raw_name = file.name().to_string();

        let normalized = raw_name.replace('\\', "/").to_lowercase();
        if normalized.contains("__macosx")
            || normalized.contains(".ds_store")
        {
            continue;
        }

        let outpath = match file.enclosed_name() {
            Some(path) => target_dir.join(path),
            None => continue,
        };

        let mut buf = Vec::with_capacity(file.size() as usize);
        std::io::copy(&mut file, &mut buf).map_err(|e| e.to_string())?;

        let hash_hex = blake3::hash(&buf).to_hex().to_string();
        let size = buf.len() as u64;

        let key = raw_name
            .strip_prefix(strip_prefix.as_str())
            .unwrap_or(&raw_name)
            .replace('\\', "/");

        let unchanged = manifest
            .get(&key)
            .map(|e| e.size == size && e.hash == hash_hex)
            .unwrap_or(false);

        if unchanged {
            continue;
        }

        if let Some(p) = outpath.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&outpath, &buf).map_err(|e| e.to_string())?;

        manifest.insert(key, FileEntry { size, hash: hash_hex });
        changed += 1;
    }

    if changed > 0 {
        save_archive_manifest(root_dir, archive_name, &manifest)?;
    }

    Ok(())
}

fn is_archive_extraction_valid(
    root_dir: &Path,
    target_dir: &Path,
    archive_name: &str,
) -> bool {
    let manifest = load_archive_manifest(root_dir, archive_name);

    if manifest.is_empty() {
        return false;
    }

    manifest.par_iter().try_for_each(|(rel_path, entry)| {
        let file_path = target_dir.join(rel_path);

        let meta = fs::metadata(&file_path).map_err(|_| ())?;
        if meta.len() != entry.size {
            return Err(());
        }

        let mut hasher = blake3::Hasher::new();
        hasher.update_mmap(&file_path).map_err(|_| ())?;
        let actual_hash = hasher.finalize().to_hex().to_string();

        if actual_hash != entry.hash {
            return Err(());
        }

        Ok(())
    }).is_ok()
}
#[tauri::command]
pub async fn sync_modpack(gta_path: String, manifest_url: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    if gta_path.trim().is_empty() {
        return Err("Calea către GTA San Andreas nu este setată în setări!".to_string());
    }

    let manifest: Manifest = reqwest::get(&manifest_url)
        .await.map_err(|e| format!("Eroare rețea manifest: {}", e))?
        .json().await.map_err(|e| format!("Eroare parsare JSON manifest: {}", e))?;

    let client = reqwest::Client::new();
    let base_path = Path::new(&gta_path);

    if !base_path.exists() {
        return Err(format!("Folderul GTA SA specificat nu există: {}", gta_path));
    }

    for entry in manifest.files {
        let clean_path = entry.path.trim_start_matches('/').trim_start_matches('\\');
        let local_path = base_path.join(clean_path);

        let needs_download = match fs::metadata(&local_path) {
            Ok(_) => {
                match sha256_file_stream(&local_path) {
                    Ok(hash) => hash != entry.sha256,
                    Err(_) => true,
                }
            }
            Err(_) => true,
        };

        if needs_download {
            let response = client.get(&entry.url)
                .send()
                .await
                .map_err(|e| format!("Eroare la conectare: {}", e))?;

            let total_size = response.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();

            while let Some(chunk_result) = stream.next().await {
                let chunk = chunk_result.map_err(|e| format!("Eroare chunk: {}", e))?;
                bytes.extend_from_slice(&chunk);
                downloaded += chunk.len() as u64;

                let percentage = if total_size > 0 {
                    ((downloaded as f64 / total_size as f64) * 100.0) as u32
                } else {
                    0
                };

                let _ = app_handle.emit_all(
                    "modpack-progress",
                    ProgressPayload {
                        file: clean_path.to_string(),
                        downloaded_mb: format!("{:.1}", downloaded as f64 / 1024.0 / 1024.0),
                        total_mb: format!("{:.1}", total_size as f64 / 1024.0 / 1024.0),
                        percentage,
                    },
                );
            }

            if clean_path.ends_with(".zip") {
                let folder_name = clean_path.trim_end_matches(".zip").to_string();
                let base_path_clone = base_path.to_path_buf();
                let bytes_clone = bytes.clone();

                tokio::task::spawn_blocking(move || {
                    extract_zip_from_memory(
                        &bytes_clone,
                        &base_path_clone,
                        &base_path_clone,
                        &folder_name,
                    )?;

                    let nested_dir = base_path_clone.join(&folder_name);
                    if nested_dir.exists() && nested_dir.is_dir() {
                        merge_dir_recursive(&nested_dir, &base_path_clone)?;
                        let _ = std::fs::remove_dir_all(&nested_dir);
                    }
                    Ok::<(), String>(())
                }).await.map_err(|e| format!("Eroare task thread: {}", e))??;

                if let Some(parent) = local_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(&local_path, &bytes).map_err(|e| format!("Eroare scriere zip local: {}", e))?;
            } else {
                if let Some(parent) = local_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(&local_path, &bytes).map_err(|e| format!("Eroare scriere fișier: {}", e))?;
            }
        }
        else if clean_path.ends_with(".zip") {
            let base_path_clone = base_path.to_path_buf();
            let local_path_clone = local_path.clone();

            
            let folder_name = clean_path.trim_end_matches(".zip").to_string();

            tokio::task::spawn_blocking(move || {
                let still_valid = is_archive_extraction_valid(
                    &base_path_clone,
                    &base_path_clone,
                    &folder_name,
                );

                if still_valid {
                    return Ok::<(), String>(());
                }
                let bytes = fs::read(&local_path_clone)
                    .map_err(|e| format!("Eroare citire ZIP local: {}", e))?;
                
                extract_zip_from_memory(
                    &bytes,
                    &base_path_clone,
                    &base_path_clone,
                    &folder_name,
                )?;

                let nested_dir = base_path_clone.join(&folder_name);

                if nested_dir.exists() && nested_dir.is_dir() {
                    merge_dir_recursive(&nested_dir, &base_path_clone)?;

                    fs::remove_dir_all(&nested_dir)
                        .map_err(|e| format!("Eroare ștergere folder extras: {}", e))?;
                }

                Ok::<(), String>(())
            })
            .await
            .map_err(|e| format!("Eroare task thread: {}", e))??;
        }
    
    }

    Ok(())
}

fn merge_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !to.exists() {
        fs::create_dir_all(to).map_err(|e| e.to_string())?;
    }

    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from_path = entry.path();
        let file_name = entry.file_name();
        let to_path = to.join(&file_name);

        if from_path.is_dir() {
            merge_dir_recursive(&from_path, &to_path)?;
        } else {
            
            if let Some(parent) = to_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}