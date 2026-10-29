import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  CallState,
  CallMode,
  CallUser,
  NetworkQuality,
  StudioEffectsConfig,
} from "./callTypes";
import IncomingCallModal from "./IncomingCallModal";
import OutgoingCallView from "./OutgoingCallView";
import ActiveCallView from "./ActiveCallView";
import MiniCallWidget from "./MiniCallWidget";
import { getSocket } from "@/lib/socket";
import { soundEffects } from "./soundEffects";

// سيرفرات STUN القياسية لـ WebRTC
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export const GlobalCallOverlay: React.FC = () => {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMode, setCallMode] = useState<CallMode>("voice");
  const [isRinging, setIsRinging] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isRemoteCameraOn, setIsRemoteCameraOn] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isNoiseSuppressionOn, setIsNoiseSuppressionOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("excellent");
  const [currentCallId, setCurrentCallId] = useState<string>("");
  const [activePartner, setActivePartner] = useState<CallUser | null>(null);

  // تدفقات الوسائط المحلية والبعيدة
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // إعدادات استوديو المؤثرات والفلاتر
  const [effects, setEffects] = useState<StudioEffectsConfig>({
    filter: "none",
    filterIntensity: 70,
    background: "none",
  });

  // مراجع لتجنب الـ Stale Closures مع الـ WebRTC والـ Sockets
  const callStateRef = useRef<CallState>("idle");
  const callModeRef = useRef<CallMode>("voice");
  const activePartnerRef = useRef<CallUser | null>(null);
  const currentCallIdRef = useRef<string>("");
  const durationSecondsRef = useRef<number>(0);
  const incomingSdpRef = useRef<any>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);
  const currentFacingModeRef = useRef<"user" | "environment">("user");

  // مزامنة المراجع مع الـ State
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { activePartnerRef.current = activePartner; }, [activePartner]);
  useEffect(() => { currentCallIdRef.current = currentCallId; }, [currentCallId]);
  useEffect(() => { durationSecondsRef.current = durationSeconds; }, [durationSeconds]);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // عنصر صوت خفي لتشغيل صوت الطرف الآخر
  useEffect(() => {
    if (typeof window !== "undefined") {
      const audio = new Audio();
      audio.autoplay = true;
      remoteAudioRef.current = audio;
      return () => {
        audio.pause();
        audio.srcObject = null;
      };
    }
  }, []);

  // تنظيف كامل لحالة المكالمة الحالية
  const cleanupCall = useCallback(() => {
    console.log("[GlobalCall] cleanupCall triggered");
    soundEffects.stopAll();

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (speechIntervalRef.current) {
      clearInterval(speechIntervalRef.current);
      speechIntervalRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    incomingSdpRef.current = null;
    pendingIceCandidatesRef.current = [];

    setIsSpeaking(false);
    setIsRinging(false);
    setIsCameraOn(false);
    setIsRemoteCameraOn(false);
    setIsScreenSharing(false);
    setCurrentCallId("");
    currentCallIdRef.current = "";
    setActivePartner(null);
    activePartnerRef.current = null;
    setCallMode("voice");
    callModeRef.current = "voice";
    setCallState("idle");
    callStateRef.current = "idle";
    setDurationSeconds(0);
  }, []);

  // تجهيز الميكروفون والكاميرا
  const setupLocalMedia = async (
    withVideo: boolean = false,
    facingMode: "user" | "environment" = "user"
  ): Promise<MediaStream | null> => {
    try {
      console.log(`[GlobalCall] Requesting media (video=${withVideo}, facingMode=${facingMode})...`);
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: isNoiseSuppressionOn,
          autoGainControl: true,
        },
        video: withVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: facingMode },
            }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOn(withVideo);
      currentFacingModeRef.current = facingMode;
      console.log("[GlobalCall] Media access granted successfully!");

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        const checkSpeech = () => {
          if (!analyserRef.current) return;
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          setIsSpeaking(avg > 18 && !isMuted);
        };
        speechIntervalRef.current = setInterval(checkSpeech, 150);
      } catch (err) {
        console.warn("[GlobalCall] Audio visualizer setup warning:", err);
      }

      return stream;
    } catch (err) {
      console.error("[GlobalCall] getUserMedia failed:", err);
      alert("تعذر الوصول إلى الوسائط (الميكروفون أو الكاميرا). يرجى التأكد من منح الإذن.");
      return null;
    }
  };

  // إنشاء وإعداد اتصال PeerConnection
  const createPeerConnection = (targetUserId: string, callId: string): RTCPeerConnection => {
    console.log(`[GlobalCall] createPeerConnection for target=${targetUserId} callId=${callId}`);
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch {}
      peerConnectionRef.current = null;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    pc.ontrack = (event) => {
      console.log("[GlobalCall] ontrack received stream:", event.streams);
      if (event.streams[0]) {
        const incomingStream = event.streams[0];
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);

        // التحقق مما إذا كان هناك مسار فيديو شغال
        const hasVideo = incomingStream.getVideoTracks().length > 0;
        if (hasVideo) {
          setIsRemoteCameraOn(true);
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = incomingStream;
          remoteAudioRef.current.play().catch((e) => console.warn("[GlobalCall] Audio autoplay caught:", e));
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[GlobalCall] Generated ICE candidate, emitting to:", targetUserId);
        const socket = getSocket();
        socket?.emit("call:ice_candidate", {
          callId,
          toUserId: String(targetUserId),
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[GlobalCall] RTCPeerConnection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setNetworkQuality("excellent");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setNetworkQuality("poor");
      }
    };

    return pc;
  };

  // إطلاق اتصال صادر عبر زر الاتصال في الدردشة (صوتي أو فيديو)
  const startOutgoingCall = useCallback(async (targetUser: CallUser, mode: CallMode = "voice") => {
    console.log("[GlobalCall] Starting outgoing call to:", targetUser, "mode:", mode);
    
    soundEffects.stopAll();
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch {}
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    setCallMode(mode);
    callModeRef.current = mode;
    activePartnerRef.current = targetUser;
    setActivePartner(targetUser);
    callStateRef.current = "outgoing";
    setCallState("outgoing");
    setIsRinging(false);
    soundEffects.startOutgoingRingback();

    const withVideo = mode === "video";
    const stream = await setupLocalMedia(withVideo);
    if (!stream) {
      soundEffects.stopAll();
      cleanupCall();
      return;
    }

    const socket = getSocket();
    if (!socket?.connected) {
      soundEffects.stopAll();
      alert("غير متصل بالخادم. يرجى التحقق من اتصال الإنترنت.");
      cleanupCall();
      return;
    }

    const tempCallId = `call_${Date.now()}`;
    currentCallIdRef.current = tempCallId;
    setCurrentCallId(tempCallId);

    const pc = createPeerConnection(targetUser.id, tempCallId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (err) {
      console.error("[GlobalCall] Failed to create offer:", err);
      cleanupCall();
      return;
    }

    let myUser: any = null;
    try {
      myUser = JSON.parse(localStorage.getItem("user") || "{}");
    } catch {}

    console.log("[GlobalCall] Emitting call:offer to server:", { toUserId: targetUser.id, mode, tempCallId });
    socket.emit(
      "call:offer",
      {
        toUserId: String(targetUser.id),
        sdp: offer,
        mode,
        callerInfo: {
          name: myUser?.name || myUser?.username || "مستخدم",
          avatar: myUser?.avatar || "/pic.png",
          rank: "عضو نشط",
        },
      },
      (res: any) => {
        console.log("[GlobalCall] Server ack for call:offer:", res);
        if (!res?.success) {
          soundEffects.stopAll();
          soundEffects.playCallEndSound();
          if (res?.busy) {
            window.dispatchEvent(
              new CustomEvent("call-logged", {
                detail: {
                  id: `log_${Date.now()}`,
                  type: "busy",
                  mode,
                  timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
                  callerId: targetUser.id,
                  callerName: targetUser.name,
                },
              })
            );
          }
          cleanupCall();
          return;
        }
        if (res.callId) {
          currentCallIdRef.current = res.callId;
          setCurrentCallId(res.callId);
        }
      }
    );

    setTimeout(() => {
      setIsRinging(true);
    }, 1500);

    timeoutTimerRef.current = setTimeout(() => {
      console.log("[GlobalCall] Outgoing call timed out (45s)");
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      const finalCallId = currentCallIdRef.current || tempCallId;
      socket.emit("call:end", {
        callId: finalCallId,
        toUserId: String(targetUser.id),
        durationSeconds: 0,
      });
      window.dispatchEvent(
        new CustomEvent("call-logged", {
          detail: {
            id: `call_${Date.now()}`,
            type: "missed",
            mode,
            timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
            callerId: targetUser.id,
            callerName: targetUser.name,
          },
        })
      );
      cleanupCall();
    }, 45000);
  }, [cleanupCall]);

  // قبول المكالمة الواردة (مع خيار الرد بالفيديو أو بالصوت فقط)
  const handleAcceptIncoming = async (withVideo: boolean = false) => {
    soundEffects.stopAll();
    const socket = getSocket();
    const callId = currentCallIdRef.current;
    const partner = activePartnerRef.current;
    console.log("[GlobalCall] Accepting incoming call. callId:", callId, "withVideo:", withVideo);

    if (!socket?.connected || !callId || !partner) {
      console.error("[GlobalCall] Cannot accept call: missing socket, callId or partner");
      return;
    }

    const nextMode: CallMode = withVideo ? "video" : callModeRef.current;
    setCallMode(nextMode);
    callModeRef.current = nextMode;

    callStateRef.current = "active";
    setCallState("active");

    const stream = await setupLocalMedia(withVideo);
    if (!stream) {
      handleRejectIncoming();
      return;
    }

    const pc = createPeerConnection(partner.id, callId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    if (incomingSdpRef.current) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(incomingSdpRef.current));
        if (pendingIceCandidatesRef.current.length > 0) {
          for (const cand of pendingIceCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
              console.warn("[GlobalCall] Error adding buffered candidate:", err);
            }
          }
          pendingIceCandidatesRef.current = [];
        }
      } catch (err) {
        console.error("[GlobalCall] setRemoteDescription error:", err);
      }
    }

    let answer: RTCSessionDescriptionInit;
    try {
      answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch (err) {
      console.error("[GlobalCall] createAnswer error:", err);
      cleanupCall();
      return;
    }

    console.log("[GlobalCall] Emitting call:answer to caller:", partner.id);
    socket.emit("call:answer", {
      callId,
      toUserId: String(partner.id),
      sdp: answer,
    });
  };

  // رفض المكالمة الواردة
  const handleRejectIncoming = () => {
    soundEffects.stopAll();
    soundEffects.playCallEndSound();
    const socket = getSocket();
    const callId = currentCallIdRef.current;
    const partner = activePartnerRef.current;

    console.log("[GlobalCall] Rejecting incoming call. callId:", callId, "partner:", partner);
    if (socket?.connected && callId && partner) {
      socket.emit("call:reject", {
        callId,
        toUserId: String(partner.id),
      });
    }

    if (partner) {
      window.dispatchEvent(
        new CustomEvent("call-logged", {
          detail: {
            id: `call_${Date.now()}`,
            type: "rejected",
            mode: callModeRef.current,
            timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
            callerId: partner.id,
            callerName: partner.name,
          },
        })
      );
    }

    cleanupCall();
  };

  // إنهاء المكالمة
  const handleEndCall = () => {
    soundEffects.stopAll();
    soundEffects.playCallEndSound();
    const socket = getSocket();
    const callId = currentCallIdRef.current;
    const partner = activePartnerRef.current;
    const duration = durationSecondsRef.current;

    console.log("[GlobalCall] Ending call. callId:", callId, "partner:", partner, "duration:", duration);
    if (socket?.connected && callId && partner) {
      socket.emit("call:end", {
        callId,
        toUserId: String(partner.id),
        durationSeconds: duration,
      });
    }

    if (partner) {
      const isCompleted = duration > 0;
      window.dispatchEvent(
        new CustomEvent("call-logged", {
          detail: {
            id: `call_${Date.now()}`,
            type: isCompleted ? "completed" : "missed",
            mode: callModeRef.current,
            durationSeconds: isCompleted ? duration : undefined,
            timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
            callerId: partner.id,
            callerName: partner.name,
          },
        })
      );
    }

    cleanupCall();
  };

  // تبديل تشغيل/إيقاف الكاميرا أثناء المكالمة بسلاسة (Smooth In-call Toggle & Upgrade)
  const toggleCamera = async () => {
    const pc = peerConnectionRef.current;
    const socket = getSocket();
    const partner = activePartnerRef.current;
    const callId = currentCallIdRef.current;

    if (isCameraOn) {
      // إيقاف الكاميرا
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = false;
          track.stop();
          localStreamRef.current?.removeTrack(track);
        });
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
      setIsCameraOn(false);

      if (socket && partner && callId) {
        socket.emit("call:camera_toggle", {
          callId,
          toUserId: String(partner.id),
          enabled: false,
        });
      }
    } else {
      // تشغيل الكاميرا وترقية المكالمة إلى فيديو
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: currentFacingModeRef.current,
          },
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        if (videoTrack) {
          if (localStreamRef.current) {
            localStreamRef.current.addTrack(videoTrack);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          } else {
            localStreamRef.current = videoStream;
            setLocalStream(videoStream);
          }

          if (pc) {
            const senders = pc.getSenders();
            const videoSender = senders.find((s) => s.track?.kind === "video");
            if (videoSender) {
              await videoSender.replaceTrack(videoTrack);
            } else {
              pc.addTrack(videoTrack, localStreamRef.current!);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket?.emit("call:offer", {
                toUserId: String(partner?.id),
                sdp: offer,
                mode: "video",
              });
            }
          }

          setIsCameraOn(true);
          setCallMode("video");
          callModeRef.current = "video";

          if (socket && partner && callId) {
            socket.emit("call:camera_toggle", {
              callId,
              toUserId: String(partner.id),
              enabled: true,
            });
          }
        }
      } catch (err) {
        console.error("[GlobalCall] Failed to turn on camera:", err);
        alert("تعذر تشغيل الكاميرا. يرجى التأكد من إذن الوصول للكاميرا.");
      }
    }
  };

  // تبديل الكاميرا الأمامية والخلفية (Flip Camera)
  const flipCamera = async () => {
    if (!isCameraOn) return;
    const nextFacing = currentFacingModeRef.current === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: nextFacing },
        },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack) {
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.stop();
            localStreamRef.current?.removeTrack(t);
          });
          localStreamRef.current.addTrack(newTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }

        const pc = peerConnectionRef.current;
        if (pc) {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (videoSender) {
            await videoSender.replaceTrack(newTrack);
          }
        }
        currentFacingModeRef.current = nextFacing;
      }
    } catch (err) {
      console.warn("[GlobalCall] flipCamera failed:", err);
    }
  };

  // مشاركة الشاشة (Screen Sharing)
  const toggleScreenShare = async () => {
    const pc = peerConnectionRef.current;
    if (isScreenSharing) {
      setIsScreenSharing(false);
      if (isCameraOn) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          const camTrack = camStream.getVideoTracks()[0];
          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
              t.stop();
              localStreamRef.current?.removeTrack(t);
            });
            localStreamRef.current.addTrack(camTrack);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          }
          if (pc) {
            const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (videoSender) await videoSender.replaceTrack(camTrack);
          }
        } catch {}
      } else {
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.stop();
            localStreamRef.current?.removeTrack(t);
          });
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (screenTrack) {
          screenTrack.onended = () => {
            toggleScreenShare();
          };

          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
              t.stop();
              localStreamRef.current?.removeTrack(t);
            });
            localStreamRef.current.addTrack(screenTrack);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          } else {
            localStreamRef.current = screenStream;
            setLocalStream(screenStream);
          }

          if (pc) {
            const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (videoSender) {
              await videoSender.replaceTrack(screenTrack);
            } else {
              pc.addTrack(screenTrack, localStreamRef.current!);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const socket = getSocket();
              socket?.emit("call:offer", {
                toUserId: String(activePartnerRef.current?.id),
                sdp: offer,
                mode: "video",
              });
            }
          }

          setIsScreenSharing(true);
          setIsCameraOn(true);
          setCallMode("video");
          callModeRef.current = "video";
        }
      } catch (err) {
        console.warn("[GlobalCall] Screen share cancelled or failed:", err);
      }
    }
  };

  // الرد السريع برسالة خاصة
  const handleQuickReply = (message: string) => {
    const socket = getSocket();
    const partner = activePartnerRef.current;
    if (socket?.connected && partner) {
      socket.emit("pm:send", {
        toUserId: String(partner.id),
        text: message,
      });
    }
    handleRejectIncoming();
  };

  const toggleMute = () => {
    const willMute = !isMuted;
    setIsMuted(willMute);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !willMute;
      });
    }
  };

  const toggleSpeaker = () => {
    const nextSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(nextSpeakerState);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !nextSpeakerState;
    }
  };

  // عداد مدة المكالمة
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (callState === "active" || callState === "minimized") {
      timer = setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setDurationSeconds(0);
    }
    return () => clearInterval(timer);
  }, [callState]);

  // الاستماع لطلب بدء مكالمة (صوتية أو فيديو)
  useEffect(() => {
    const handleStartCallEvent = (e: any) => {
      const targetUser = e.detail?.user;
      const requestedMode: CallMode = e.detail?.mode === "video" ? "video" : "voice";
      console.log("[GlobalCall] start-voice-call custom event received:", targetUser, "mode:", requestedMode);
      if (targetUser) {
        startOutgoingCall(targetUser, requestedMode);
      }
    };
    window.addEventListener("start-voice-call", handleStartCallEvent);
    return () => window.removeEventListener("start-voice-call", handleStartCallEvent);
  }, [startOutgoingCall]);

  // الاستماع لأحداث إشارات السوكيت (Signaling)
  useEffect(() => {
    const rawUser = localStorage.getItem("user") || localStorage.getItem("auth_user");
    if (!rawUser) {
      return;
    }

    const socket = getSocket();
    if (!socket) {
      console.warn("[GlobalCall] socket not available for signaling");
      return;
    }

    console.log("[GlobalCall] Registering socket call listeners");

    const onCallIncoming = async (data: any) => {
      console.log("[GlobalCall] onCallIncoming event received:", data);

      let myUserId = "";
      try {
        const u = JSON.parse(localStorage.getItem("user") || "{}");
        myUserId = String(u.id || "");
      } catch {}

      if (data.fromUserId && myUserId && String(data.fromUserId) === myUserId) {
        console.log("[GlobalCall] Ignoring onCallIncoming from self");
        return;
      }

      if (callStateRef.current === "outgoing" && activePartnerRef.current && String(activePartnerRef.current.id) === String(data.fromUserId)) {
        console.log("[GlobalCall] We are already calling this partner, ignoring onCallIncoming");
        return;
      }

      if (currentCallIdRef.current && currentCallIdRef.current === data.callId) {
        console.log("[GlobalCall] Duplicate onCallIncoming for current callId, ignoring");
        return;
      }

      if (callStateRef.current !== "idle") {
        console.log("[GlobalCall] User is busy in state:", callStateRef.current);
        socket.emit("call:reject", {
          callId: data.callId,
          toUserId: String(data.fromUserId),
          reason: "المستخدم مشغول حالياً",
        });
        return;
      }

      const incomingMode: CallMode = data.mode === "video" ? "video" : "voice";
      setCallMode(incomingMode);
      callModeRef.current = incomingMode;
      setIsRemoteCameraOn(incomingMode === "video");

      currentCallIdRef.current = data.callId;
      setCurrentCallId(data.callId);
      activePartnerRef.current = data.caller;
      setActivePartner(data.caller);
      incomingSdpRef.current = data.sdp || null;
      callStateRef.current = "incoming";
      setCallState("incoming");
      soundEffects.startIncomingRingtone();
    };

    const onCallAnswered = async (data: any) => {
      console.log("[GlobalCall] onCallAnswered received:", data);
      soundEffects.stopAll();
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      if (peerConnectionRef.current && data.sdp) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          if (pendingIceCandidatesRef.current.length > 0) {
            for (const cand of pendingIceCandidatesRef.current) {
              try {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
              } catch (e) {
                console.warn("[GlobalCall] Error adding buffered candidate:", e);
              }
            }
            pendingIceCandidatesRef.current = [];
          }
        } catch (err) {
          console.error("[GlobalCall] onCallAnswered setRemoteDescription error:", err);
        }
      }
      callStateRef.current = "active";
      setCallState("active");
    };

    const onIceCandidate = async (data: any) => {
      try {
        if (peerConnectionRef.current && data.candidate) {
          if (peerConnectionRef.current.remoteDescription) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            pendingIceCandidatesRef.current.push(data.candidate);
          }
        }
      } catch (err) {
        console.warn("[GlobalCall] Add ICE candidate error:", err);
      }
    };

    const onCameraToggled = (data: any) => {
      console.log("[GlobalCall] onCameraToggled event received:", data);
      setIsRemoteCameraOn(Boolean(data.enabled));
      if (data.enabled) {
        setCallMode("video");
        callModeRef.current = "video";
      }
    };

    const onCallRejected = (data?: any) => {
      console.log("[GlobalCall] onCallRejected received:", data);
      if (data?.callId && currentCallIdRef.current && data.callId !== currentCallIdRef.current) {
        console.log("[GlobalCall] onCallRejected for different callId, ignoring");
        return;
      }
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      const partner = activePartnerRef.current;
      if (partner) {
        window.dispatchEvent(
          new CustomEvent("call-logged", {
            detail: {
              id: `call_${Date.now()}`,
              type: "rejected",
              mode: callModeRef.current,
              timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
              callerId: partner.id,
              callerName: partner.name,
            },
          })
        );
      }
      cleanupCall();
    };

    const onCallBusy = () => {
      console.log("[GlobalCall] onCallBusy received");
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      const partner = activePartnerRef.current;
      if (partner) {
        window.dispatchEvent(
          new CustomEvent("call-logged", {
            detail: {
              id: `call_${Date.now()}`,
              type: "busy",
              mode: callModeRef.current,
              timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
              callerId: partner.id,
              callerName: partner.name,
            },
          })
        );
      }
      cleanupCall();
    };

    const onCallEnded = (data: any) => {
      console.log("[GlobalCall] onCallEnded received:", data);
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      const partner = activePartnerRef.current;
      const duration = durationSecondsRef.current || data?.durationSeconds || 0;
      if (partner && duration > 0) {
        window.dispatchEvent(
          new CustomEvent("call-logged", {
            detail: {
              id: `call_${Date.now()}`,
              type: "completed",
              mode: callModeRef.current,
              durationSeconds: duration,
              timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
              callerId: partner.id,
              callerName: partner.name,
            },
          })
        );
      }
      cleanupCall();
    };

    socket.on("call:incoming", onCallIncoming);
    socket.on("call:answered", onCallAnswered);
    socket.on("call:ice_candidate", onIceCandidate);
    socket.on("call:camera_toggled", onCameraToggled);
    socket.on("call:rejected", onCallRejected);
    socket.on("call:busy", onCallBusy);
    socket.on("call:ended", onCallEnded);

    return () => {
      console.log("[GlobalCall] Deregistering socket call listeners");
      socket.off("call:incoming", onCallIncoming);
      socket.off("call:answered", onCallAnswered);
      socket.off("call:ice_candidate", onIceCandidate);
      socket.off("call:camera_toggled", onCameraToggled);
      socket.off("call:rejected", onCallRejected);
      socket.off("call:busy", onCallBusy);
      socket.off("call:ended", onCallEnded);
    };
  }, [cleanupCall]);

  if (callState === "idle" || !activePartner) return null;

  return (
    <>
      {/* 1. إشعار المكالمة الواردة (صوتية أو فيديو) */}
      {callState === "incoming" && (
        <IncomingCallModal
          caller={activePartner}
          mode={callMode}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
          onQuickReply={handleQuickReply}
        />
      )}

      {/* 2. شاشة المكالمة الصادرة */}
      {callState === "outgoing" && (
        <OutgoingCallView
          user={activePartner}
          mode={callMode}
          isRinging={isRinging}
          onCancel={handleEndCall}
        />
      )}

      {/* 3. شاشة المكالمة النشطة (Dual-Stream Video + Audio) */}
      {callState === "active" && (
        <ActiveCallView
          user={activePartner}
          mode={callMode}
          durationSeconds={durationSeconds}
          networkQuality={networkQuality}
          isMuted={isMuted}
          isCameraOn={isCameraOn}
          isSpeakerOn={isSpeakerOn}
          isNoiseSuppressionOn={isNoiseSuppressionOn}
          isScreenSharing={isScreenSharing}
          isSpeaking={isSpeaking}
          isRemoteCameraOn={isRemoteCameraOn}
          analyser={analyserRef.current}
          localStream={localStream}
          remoteStream={remoteStream}
          effects={effects}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onFlipCamera={flipCamera}
          onToggleScreenShare={toggleScreenShare}
          onToggleSpeaker={toggleSpeaker}
          onToggleNoiseSuppression={() => setIsNoiseSuppressionOn((p) => !p)}
          onChangeEffects={setEffects}
          onMinimize={() => {
            callStateRef.current = "minimized";
            setCallState("minimized");
          }}
          onEndCall={handleEndCall}
        />
      )}

      {/* 4. الوضع المصغر العائم PiP */}
      {callState === "minimized" && (
        <MiniCallWidget
          user={activePartner}
          durationSeconds={durationSeconds}
          isMuted={isMuted}
          isSpeaking={isSpeaking}
          onMaximize={() => {
            callStateRef.current = "active";
            setCallState("active");
          }}
          onToggleMute={toggleMute}
          onEndCall={handleEndCall}
        />
      )}
    </>
  );
};

export default GlobalCallOverlay;
