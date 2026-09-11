import { invoke } from "@tauri-apps/api";
import { open } from "@tauri-apps/api/dialog";
import { t } from "i18next";
import { StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import Text from "../../../components/Text";
import { useAppState } from "../../../states/app";
import { useSettings } from "../../../states/settings";
import { useTheme } from "../../../states/theme";
import { checkDirectoryValidity } from "../../../utils/game";
import { Log } from "../../../utils/logger";
import { sc } from "../../../utils/sizeScaler";
import { stateStorage } from "../../../utils/stateStorage";

const General = () => {
  const { hostOS } = useAppState();
  const { theme } = useTheme();
  const { gtasaPath, setGTASAPath, setNickName } = useSettings();

  const selectPath = async () => {
    const selected: string = (await open({
      defaultPath:
        hostOS === "Windows_NT" ? gtasaPath.replace(/\//g, "\\") : gtasaPath,
      directory: true,
    })) as string;

    if (selected) {
      const newPath = selected.replace(/\\/g, "/");

      const isDirValid = await checkDirectoryValidity(newPath);
      if (isDirValid) setGTASAPath(newPath);
    }
  };

  const importDataFromSAMP = async () => {
    try {
      const path: string = await invoke("get_gtasa_path_from_samp");
      if (path.length) {
        const newPath = path.replace(/\\/g, "/");
        const isDirValid = await checkDirectoryValidity(newPath);
        if (isDirValid) setGTASAPath(newPath);
      }

      const name: string = await invoke("get_nickname_from_samp");
      if (name.length) {
        setNickName(name);
      }
    } catch (e) {
      Log.debug(e);
    }
  };

  return (
    <View
      style={{
        paddingHorizontal: 12,
        overflow: "hidden",
        paddingVertical: 10,
        flex: 1,
      }}
    >
      <Text semibold color={theme.textPrimary} size={2}>
        {t("settings_gta_path_input_label")}:
      </Text>
      <View style={styles.pathInputContainer}>
        <TextInput
          value={gtasaPath}
          onChangeText={(text) => setGTASAPath(text)}
          style={[
            styles.pathInput,
            {
              color: theme.textPrimary,
              backgroundColor: theme.textInputBackgroundColor,
            },
          ]}
        />
        <TouchableOpacity
          style={[
            styles.browseButton,
            {
              backgroundColor: `${theme.primary}BB`,
              borderColor: theme.textSecondary,
            },
          ]}
          onPress={() => selectPath()}
        >
          <Text semibold color={"#FFFFFF"} size={2}>
            {t("browse")}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[
          styles.importButton,
          {
            backgroundColor: `${theme.primary}BB`,
            borderColor: theme.textSecondary,
          },
        ]}
        onPress={() => importDataFromSAMP()}
      >
        <Text semibold color={"#FFFFFF"} size={2}>
          {t("settings_import_nickname_gta_path_from_samp")}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[
          styles.resetButton,
          {
            backgroundColor: "red",
          },
        ]}
        onPress={() => {
          stateStorage.clear();
          localStorage.clear();
          window.location.reload();
        }}
      >
        <Text semibold color={"#FFFFFF"} size={2}>
          {t("settings_reset_application_data")}
        </Text>
      </TouchableOpacity>
      
    </View>
  );
};

const styles = StyleSheet.create({
  pathInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginTop: 7,
  },
  pathInput: {
    paddingHorizontal: sc(10),
    flex: 1,
    height: sc(38),
    borderRadius: sc(5),
    // @ts-ignore
    outlineStyle: "none",
    fontFamily: "Proxima Nova Regular",
    fontSize: sc(17),
  },
  browseButton: {
    height: sc(36),
    paddingHorizontal: sc(15),
    borderRadius: sc(5),
    marginLeft: sc(10),
    justifyContent: "center",
    alignItems: "center",
  },
  importButton: {
    marginTop: sc(8),
    height: sc(36),
    paddingHorizontal: sc(10),
    borderRadius: sc(5),
    justifyContent: "center",
    alignItems: "center",
  },
  resetButton: {
    marginTop: sc(8),
    height: sc(36),
    paddingHorizontal: sc(10),
    borderRadius: sc(5),
    justifyContent: "center",
    alignItems: "center",
  },
  appInfoContainer: {
    flex: 1,
    justifyContent: "flex-end",
    width: "100%",
    alignItems: "center",
  },
});

export default General;
