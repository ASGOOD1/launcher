import { invoke, path, shell } from "@tauri-apps/api";
import { listen } from "@tauri-apps/api/event";
import { t } from "i18next";

import { useMessageBox } from "../states/messageModal";
import {
  validFileChecksums,
} from "../constants/app";
import { memo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SERVER_CONFIG } from "../constants/server";
import { useSettings } from "../states/settings";
import { useSettingsModal } from "../states/settingsModal";
import { useTheme } from "../states/theme";
import { Log } from "../utils/logger";
import { sc } from "../utils/sizeScaler";

interface ModpackProgressPayload {
  file: string;
  downloaded_mb: string;
  total_mb: string;
  percentage: number;
}

const getLocalPath = async (...segments: string[]) =>
  path.join(await path.appLocalDataDir(), ...segments);
const DedicatedMainView = memo(() => {
  const { theme } = useTheme();
  const { gtasaPath, recentNicknames, customGameExe, sampVersion } = useSettings();
  const { show: showSettings } = useSettingsModal();

  const [nickname, setNickname] = useState(recentNicknames[0] || "");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const { showMessageBox, hideMessageBox } = useMessageBox.getState();

  const handlePlay = async () => {
    if (!gtasaPath) {
      showSettings();
      return;
    }

    if (!nickname.trim()) {
      setErrorMessage("Te rog introdu un nickname valid înainte de a intra pe server!");
      return;
    }

    setIsConnecting(true);
    setErrorMessage(null);

    try {
      // 1. Sincronizare Modpack cu bară de progres
      setStatusText("Verifying files integrity...");

      const unlisten = await listen<ModpackProgressPayload>("modpack-progress", (event) => {
        const { file, downloaded_mb, total_mb, percentage } = event.payload;
        setStatusText(`Downloading resource ${file} (${percentage}%)\n${downloaded_mb} MB / ${total_mb} MB`);
      });

      await invoke("sync_modpack", {
        gtaPath: gtasaPath,
        manifestUrl: SERVER_CONFIG.manifestUrl,
      });

      unlisten();

      setStatusText("Loading game...");
      const idealSAMPDllPath = await path.join(gtasaPath, "samp.dll");
        const file = validFileChecksums.get(
          sampVersion !== "custom" ? sampVersion : "037R1_samp.dll"
        );
        const ourSAMPDllPath =
          sampVersion === "custom"
            ? idealSAMPDllPath
            : file
              ? await getLocalPath(file.path, file.name)
              : idealSAMPDllPath;
      
        invoke("inject", {
          name: nickname,
          ip: SERVER_CONFIG.ip,
          port: SERVER_CONFIG.port,
          exe: gtasaPath,
          dll: ourSAMPDllPath,
          ompFile: await getLocalPath("omp", "omp-client.dll"),
          password: "ebilesaunuebile",
          customGameExe,
        })
          .then(() => {
            useSettings.getState().addRecentNickname(nickname);
          })
          .catch((e) => {
            if (e === "need_admin") {
              showMessageBox({
                title: t("admin_permissions_required_modal_title"),
                description: t("admin_permissions_required_modal_description"),
                buttons: [
                  {
                    title: t("run_as_admin"),
                    onPress: () =>
                      shell
                        .open("https://assets.open.mp/run_as_admin.gif")
                        .then(() => process.exit()),
                  },
                  { title: t("cancel"), onPress: hideMessageBox },
                ],
              });
            }
          });

      useSettings.getState().addRecentNickname(nickname.trim());
      setStatusText(null);
    } catch (e: any) {
      Log.debug("Start error:", e);
      setErrorMessage(`Couldn't start game: ${e}`);
    } finally {
      setIsConnecting(false);
      setStatusText(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.secondary }]}>
      <View style={styles.contentBox}>
        <Text style={[styles.serverTitle, { color: theme.textPrimary }]}>{SERVER_CONFIG.name}</Text>
        <Text style={[styles.serverSub, { color: theme.textSecondary }]}>Server Oficial • Open.mp / SA-MP</Text>

        {/* Afișare status descărcare / progres */}
        {statusText && (
          <View style={[styles.statusBox, { backgroundColor: theme.primary }]}>
            <Text style={[styles.statusText, { color: theme.textPrimary }]}>{statusText}</Text>
          </View>
        )}

        {/* Afișare erori */}
        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity onPress={() => setErrorMessage(null)}>
              <Text style={styles.errorClose}>[Închide]</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: theme.textPrimary }]}>Nume / Nickname:</Text>
          <TextInput
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary, backgroundColor: theme.primary }]}
            placeholder="Ex: John_Doe"
            placeholderTextColor={theme.textSecondary}
            value={nickname}
            onChangeText={setNickname}
            maxLength={20}
            editable={!isConnecting}
          />
        </View>

        <TouchableOpacity 
          style={[styles.playButton, { backgroundColor: "#4e9f3d", opacity: isConnecting ? 0.7 : 1 }]} 
          onPress={handlePlay}
          disabled={isConnecting}
        >
          <Text style={styles.playButtonText}>{isConnecting ? "LOADING..." : "PLAY"}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={showSettings}
          disabled={isConnecting}
        >
          <Text style={[styles.settingsButtonText, { color: theme.textSecondary }]}>⚙ Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

DedicatedMainView.displayName = "DedicatedMainView";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  contentBox: {
    width: sc(380),
    padding: sc(25),
    borderRadius: sc(12),
    alignItems: "center",
  },
  serverTitle: {
    fontSize: sc(28),
    fontWeight: "bold",
    marginBottom: sc(5),
    textAlign: "center",
  },
  serverSub: {
    fontSize: sc(14),
    marginBottom: sc(20),
    textAlign: "center",
  },
  statusBox: {
    width: "100%",
    padding: sc(12),
    borderRadius: sc(8),
    marginBottom: sc(15),
    alignItems: "center",
  },
  statusText: {
    fontSize: sc(13),
    textAlign: "center",
    fontWeight: "600",
  },
  errorBox: {
    width: "100%",
    padding: sc(10),
    backgroundColor: "rgba(255, 0, 0, 0.15)",
    borderRadius: sc(8),
    marginBottom: sc(15),
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 0, 0, 0.4)",
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: sc(12),
    textAlign: "center",
    marginBottom: sc(5),
  },
  errorClose: {
    color: "#ff6b6b",
    fontSize: sc(11),
    fontWeight: "bold",
  },
  formGroup: {
    width: "100%",
    marginBottom: sc(20),
  },
  label: {
    fontSize: sc(14),
    marginBottom: sc(8),
    fontWeight: "600",
  },
  input: {
    width: "100%",
    height: sc(45),
    borderWidth: 1,
    borderRadius: sc(8),
    paddingHorizontal: sc(12),
    fontSize: sc(15),
  },
  playButton: {
    width: "100%",
    height: sc(50),
    borderRadius: sc(8),
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  playButtonText: {
    color: "#ffffff",
    fontSize: sc(16),
    fontWeight: "bold",
    letterSpacing: 1,
  },
  settingsButton: {
    marginTop: sc(15),
    padding: sc(8),
  },
  settingsButtonText: {
    fontSize: sc(13),
    textDecorationLine: "underline",
  },
});

export default DedicatedMainView;