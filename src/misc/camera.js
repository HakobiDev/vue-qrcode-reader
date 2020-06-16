import adapterFactory from "webrtc-adapter/src/js/adapter_factory.js";
import { StreamApiNotSupportedError, InsecureContextError } from "./errors.js";
import { imageDataFromVideo } from "./image-data.js";
import { eventOn } from "callforth";

class Camera {
  constructor(videoEl, stream) {
    this.videoEl = videoEl;
    this.stream = stream;
  }

  stop() {
    this.stream.getTracks().forEach(track => track.stop());
  }

  captureFrame() {
    return imageDataFromVideo(this.videoEl);
  }

  getCapabilities() {
    const [track] = this.stream.getVideoTracks();

    return track.getCapabilities();
  }
}

const narrowDownFacingMode = async camera => {
  // Modern phones often have multipe front/rear cameras.
  // Sometimes special purpose cameras like the wide-angle camera are picked
  // by default. Those are not optimal for scanning QR codes but standard
  // media constraints don't allow us to specify which camera we want exactly.
  // However, explicitly picking the first entry in the list of all videoinput
  // devices for as the default front camera and the last entry as the default
  // rear camera seems to be a workaround.
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    ({ kind }) => kind === "videoinput"
  );

  // if (devices.length > 2) {
  if (false) {
    const frontCamera = devices[0];
    const rearCamera = devices[devices.length - 1];

    switch (camera) {
      case "auto":
        return { deviceId: { exact: rearCamera.deviceId } };
      case "rear":
        return { deviceId: { exact: rearCamera.deviceId } };
      case "front":
        return { deviceId: { exact: frontCamera.deviceId } };
      default:
        return undefined;
    }
  } else {
    switch (camera) {
      case "auto":
        return { facingMode: { ideal: "environment" } };
      case "rear":
        return { facingMode: { exact: "environment" } };
      case "front":
        return { facingMode: { exact: "user" } };
      default:
        return undefined;
    }
  }
};

const INSECURE_CONTEXT = window.isSecureContext !== true;

const STREAM_API_NOT_SUPPORTED = !(
  navigator &&
  (navigator.getUserMedia ||
    (navigator.mediaDevices && navigator.mediaDevices.getUserMedia))
);

let streamApiShimApplied = false;

export default async function(videoEl, { camera, torch }) {
  // At least in Chrome `navigator.mediaDevices` is undefined when the page is
  // loaded using HTTP rather than HTTPS. Thus `STREAM_API_NOT_SUPPORTED` is
  // initialized with `false` although the API might actually be supported.
  // So although `getUserMedia` already should have a built-in mechanism to
  // detect insecure context (by throwing `NotAllowedError`), we have to do a
  // manual check before even calling `getUserMedia`.
  if (INSECURE_CONTEXT) {
    throw new InsecureContextError();
  }

  if (STREAM_API_NOT_SUPPORTED) {
    throw new StreamApiNotSupportedError();
  }

  // This is a brower API only shim. It patches the global window object which
  // is not available during SSR. So we lazily apply this shim at runtime.
  if (streamApiShimApplied === false) {
    adapterFactory({ window });
    streamApiShimApplied = true;
  }

  const constraints = {
    audio: false,
    video: {
      width: { min: 360, ideal: 640, max: 1920 },
      height: { min: 240, ideal: 480, max: 1080 },
      ...(await narrowDownFacingMode(camera))
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  if (videoEl.srcObject !== undefined) {
    videoEl.srcObject = stream;
  } else if (videoEl.mozSrcObject !== undefined) {
    videoEl.mozSrcObject = stream;
  } else if (window.URL.createObjectURL) {
    videoEl.src = window.URL.createObjectURL(stream);
  } else if (window.webkitURL) {
    videoEl.src = window.webkitURL.createObjectURL(stream);
  } else {
    videoEl.src = stream;
  }

  await eventOn(videoEl, "loadeddata");

  if (torch) {
    const [track] = stream.getVideoTracks();

    try {
      await track.applyConstraints({ advanced: [{ torch: true }] });
    } catch (error) {
      console.warn("device does not support torch capability");
    }
  }

  return new Camera(videoEl, stream);
}
