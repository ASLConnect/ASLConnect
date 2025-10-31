import * as React from "react";
import { Stack, useRouter } from "expo-router";
import {
  Alert,
  StyleSheet,
  Switch,
  TouchableHighlight,
  View,
} from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Camera, CameraPermissionStatus } from "react-native-vision-camera";
import { Ionicons } from "@expo/vector-icons";

const ICON_SIZE = 26;

export default function PermissionsScreen() {
  const router = useRouter();
  const [cameraPermissionStatus, setCameraPermissionStatus] =
    React.useState<CameraPermissionStatus>("not-determined");
  const [microphonePermissionStatus, setMicrophonePermissionStatus] =
    React.useState<CameraPermissionStatus>("not-determined");

  React.useEffect(() => {
    (async () => {
      const camPerm = await Camera.getCameraPermissionStatus();
      setCameraPermissionStatus(camPerm);
      const micPerm = await Camera.getMicrophonePermissionStatus();
      setMicrophonePermissionStatus(micPerm);
    })();
  }, []);

  const requestMicrophonePermission = async () => {
    const permission = await Camera.requestMicrophonePermission();

    setMicrophonePermissionStatus(permission);
  };

  const requestCameraPermission = async () => {
    const permission = await Camera.requestCameraPermission();

    setCameraPermissionStatus(permission);
  };

  const handleContinue = () => {
    if (
      cameraPermissionStatus === "granted" &&
      microphonePermissionStatus === "granted"
    ) {
      router.replace("/");
    } else {
      Alert.alert("Please go to settings and enable permissions");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Permissions" }} />
      <ThemedView style={styles.container}>
        <View style={styles.spacer} />

        <ThemedText type="subtitle" style={styles.subtitle}>
          ASL needs access to a few permissions in order to work properly.
        </ThemedText>

        <View style={styles.spacer} />

        <View style={styles.row}>
          <Ionicons
            name="lock-closed-outline"
            color={"orange"}
            size={ICON_SIZE}
          />
          <ThemedText style={styles.footnote}>REQUIRED</ThemedText>
        </View>

        <View style={styles.spacer} />

        <View
          style={StyleSheet.compose(styles.row, styles.permissionContainer)}
        >
          <Ionicons name="camera-outline" color={"gray"} size={ICON_SIZE} />
          <View style={styles.permissionText}>
            <ThemedText type="subtitle">Camera</ThemedText>
            <ThemedText>Used for taking photos.</ThemedText>
          </View>
          <Switch
            trackColor={{ true: "orange" }}
            value={cameraPermissionStatus === "granted"}
            onValueChange={async () => {
              console.log('Camera permission switch toggled');
              const permission = await Camera.requestCameraPermission();
              setCameraPermissionStatus(permission);
            }}
          />
        </View>

        <View style={styles.spacer} />

        <View
          style={StyleSheet.compose(styles.row, styles.permissionContainer)}
        >
          <View style={styles.row}>
            <Ionicons
              name="mic-circle-outline"
              color={"gray"}
              size={ICON_SIZE}
            />
            <View style={styles.permissionText}>
              <ThemedText type="subtitle">Microphone</ThemedText>
              <ThemedText>Used for other features.</ThemedText>
            </View>
          </View>
          <Switch
            trackColor={{ true: "orange" }}
            value={microphonePermissionStatus === "granted"}
            onValueChange={async () => {
              console.log('Microphone permission switch toggled');
              const permission = await Camera.requestMicrophonePermission();
              setMicrophonePermissionStatus(permission);
            }}
          />
        </View>

        <View style={styles.spacer} />
        <View style={styles.spacer} />
        <View style={styles.spacer} />

        <TouchableHighlight
          onPress={() => router.replace('/')}
          style={StyleSheet.compose(styles.row, [styles.continueButton, { backgroundColor: 'black', borderColor: 'black' }])}
          underlayColor="#222"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ThemedText style={{ color: 'white', fontWeight: 'bold' }}>Next</ThemedText>
            <Ionicons
              name="arrow-forward-outline"
              color={"white"}
              size={ICON_SIZE}
            />
          </View>
        </TouchableHighlight>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  subtitle: {
    textAlign: "center",
  },
  footnote: {
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  spacer: {
    marginVertical: 8,
  },
  permissionContainer: {
    backgroundColor: "#ffffff20",
    borderRadius: 10,
    padding: 10,
    justifyContent: "space-between",
  },
  permissionText: {
    marginLeft: 10,
    flexShrink: 1,
  },
  continueButton: {
    padding: 10,
    borderWidth: 2,
    borderColor: "white",
    borderRadius: 50,
    alignSelf: "center",
  },
});
