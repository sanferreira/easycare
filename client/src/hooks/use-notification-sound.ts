import { useCallback, useEffect, useState } from "react";

const DEFAULT_NOTIFICATION_SOUND_SRC = "/sounds/notificacao-flashscore.mp3";

type UnlockOptions = {
  preview?: boolean;
};

let sharedAudio: HTMLAudioElement | null = null;
let sharedAudioSrc = "";
let sharedUnlocked = false;
const listeners = new Set<(isUnlocked: boolean) => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener(sharedUnlocked));
}

function setSharedUnlocked(value: boolean) {
  sharedUnlocked = value;
  notifyListeners();
}

function getAudio(src: string) {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  if (!sharedAudio || sharedAudioSrc !== src) {
    sharedAudio = new Audio(src);
    sharedAudio.preload = "auto";
    sharedAudio.volume = 0.75;
    sharedAudioSrc = src;
    sharedUnlocked = false;
  }

  return sharedAudio;
}

export function useNotificationSound(src = DEFAULT_NOTIFICATION_SOUND_SRC) {
  const [isUnlocked, setIsUnlocked] = useState(sharedUnlocked);

  const unlock = useCallback(async (options: UnlockOptions = {}) => {
    const audio = getAudio(src);
    if (!audio) return false;
    if (sharedUnlocked && !options.preview) return true;

    const previousVolume = audio.volume;
    if (!options.preview) audio.volume = 0;

    try {
      audio.currentTime = 0;
      await audio.play();

      if (!options.preview) {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = previousVolume;
      } else {
        audio.volume = 0.75;
      }

      setSharedUnlocked(true);
      return true;
    } catch {
      audio.volume = previousVolume;
      setSharedUnlocked(false);
      return false;
    }
  }, [src]);

  const play = useCallback(() => {
    const audio = getAudio(src);
    if (!audio) return;

    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers only allow currentTime changes after metadata is ready.
    }

    audio.volume = 0.75;
    void audio.play()
      .then(() => setSharedUnlocked(true))
      .catch(() => setSharedUnlocked(false));
  }, [src]);

  useEffect(() => {
    getAudio(src);
    const listener = (nextUnlocked: boolean) => setIsUnlocked(nextUnlocked);
    listeners.add(listener);
    listener(sharedUnlocked);

    const unlockAudio = () => {
      void unlock();
    };

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      listeners.delete(listener);
    };
  }, [src, unlock]);

  return { isUnlocked, play, unlock };
}
