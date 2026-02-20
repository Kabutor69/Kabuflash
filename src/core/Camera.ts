export async function initCamera(): Promise<HTMLVideoElement> {
  const video = document.getElementById("webcam") as HTMLVideoElement;

  if (!video) {
    throw new Error("Video element with id 'webcam' not found in document.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user"
    },
  });

  video.srcObject = stream;
  video.play();

  // Wait for both metadata AND actual video dimensions
  await new Promise<void>((resolve) => {
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
      } else {
        video.onloadeddata = () => resolve();
      }
    };
    if (video.readyState >= 2) {
      check();
    } else {
      video.onloadedmetadata = check;
    }
  });

  return video;
}