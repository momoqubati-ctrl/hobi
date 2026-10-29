import React, { useState, useEffect, useRef, useCallback } from "react";
import { CallState, CallUser, NetworkQuality, CallLogMessage } from "./callTypes";
import IncomingCallModal from "./IncomingCallModal";
import OutgoingCallView from "./OutgoingCallView";
import ActiveCallView from "./ActiveCallView";
import MiniCallWidget from "./MiniCallWidget";
import { getSocket } from "@/lib/socket";
import { soundEffects } from "./soundEffects";

interface VoiceCallManagerProps {
  otherUser: CallUser;
  currentUser?: { id: string; name: string; avatar: string; rank?: string };
  startCallTrigger?: boolean;
  onSendChatMessage?: (text: string) => void;
  onCallLogged?: (log: CallLogMessage) => void;
  onCallStateChanged?: (state: CallState) => void;
}

// سيرفرات STUN القياسية لـ WebRTC المجانية والموثوقة
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export const VoiceCallManager: React.FC<VoiceCallManagerProps> = ({
  otherUser,
  currentUser,
  startCallTrigger,
  onSendChatMessage,
  onCallLogged,
  onCallStateChanged,
}) => {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isRinging, setIsRinging] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isNoiseSuppressionOn, setIsNoiseSuppressionOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("excellent");
  const [currentCallId, setCurrentCallId] = useState<string>("");
  const [incomingCaller, setIncomingCaller] = useState<CallUser | null>(null);

  // مراجع WebRTC و Audio Streams
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // إشعار الأب بتغير الحالة
  useEffect(() => {
    onCallStateChanged?.(callState);
  }, [callState, onCallStateChanged]);

  // إنشاء عنصر صوت خفي في الـ DOM لتشغيل صوت الطرف الآخر
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

  // تنظيف الموارد بالكامل (Cleanup)
  const cleanupCall = useCallback(() => {
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
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
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

    setIsSpeaking(false);
    setIsRinging(false);
    setCurrentCallId("");
  }, []);

  // إعداد ميكروفون المستخدم وتحليل الصوت (Audio Analyser)
  const setupLocalMedia = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: isNoiseSuppressionOn,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;

      // إعداد AudioContext & AnalyserNode لمؤشر الطيف الصوتي الحقيقي
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        // مراقبة تردد الصوت لتحديث مؤشر التحدث (isSpeaking)
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
        console.warn("[WebRTC] AudioContext visualizer fallback:", err);
      }

      return stream;
    } catch (err) {
      console.error("[WebRTC] getUserMedia failed:", err);
      alert("تعذر الوصول إلى الميكروفون. يرجى التأكد من منح الإذن.");
      return null;
    }
  };

  // تهيئة اتصال RTCPeerConnection
  const createPeerConnection = (targetUserId: string, callId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // استقبال مسارات الصوت للطرف الآخر
    pc.ontrack = (event) => {
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    // إرسال مرشحي ICE للطرف الآخر عبر الـ Socket
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = getSocket();
        socket?.emit("call:ice_candidate", {
          callId,
          toUserId: targetUserId,
          candidate: event.candidate,
        });
      }
    };

    // تتبع حالة الاتصال
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setNetworkQuality("excellent");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setNetworkQuality("poor");
      }
    };

    return pc;
  };

  // 1. بدء مكالمة صادرة (Start Outgoing Call)
  const initiateOutgoingCall = async () => {
    cleanupCall();
    setCallState("outgoing");
    setIsRinging(false);
    soundEffects.startOutgoingRingback();

    const stream = await setupLocalMedia();
    if (!stream) {
      soundEffects.stopAll();
      setCallState("idle");
      return;
    }

    const socket = getSocket();
    if (!socket?.connected) {
      soundEffects.stopAll();
      alert("غير متصل بالخادم");
      cleanupCall();
      setCallState("idle");
      return;
    }

    const tempCallId = `call_${Date.now()}`;
    const pc = createPeerConnection(otherUser.id, tempCallId);

    // إضافة مسارات الميكروفون
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // إنشاء SDP Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // إرسال الإشارة عبر السوكيت
    socket.emit(
      "call:offer",
      {
        toUserId: otherUser.id,
        sdp: offer,
        callerInfo: {
          name: currentUser?.name || "أنا",
          avatar: currentUser?.avatar || "/pic.png",
          rank: currentUser?.rank || "عضو نشط",
        },
      },
      (res: any) => {
        if (!res?.success) {
          soundEffects.stopAll();
          soundEffects.playCallEndSound();
          cleanupCall();
          setCallState("idle");
          if (res?.busy) {
            onCallLogged?.({
              id: `log_${Date.now()}`,
              type: "busy",
              timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
              callerId: otherUser.id,
              callerName: otherUser.name,
            });
          }
          return;
        }
        setCurrentCallId(res.callId || tempCallId);
      }
    );

    // تحول الحالة إلى "يرن..." بعد 1.5 ثانية
    setTimeout(() => {
      setIsRinging(true);
    }, 1500);

    // مهلة زمنية 45 ثانية إذا لم يرد الطرف الآخر
    timeoutTimerRef.current = setTimeout(() => {
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      socket.emit("call:end", {
        callId: tempCallId,
        toUserId: otherUser.id,
        durationSeconds: 0,
      });
      cleanupCall();
      setCallState("idle");
      onCallLogged?.({
        id: `call_${Date.now()}`,
        type: "missed",
        timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        callerId: otherUser.id,
        callerName: otherUser.name,
      });
    }, 45000);
  };

  // 2. قبول مكالمة واردة (Accept Incoming Call)
  const handleAcceptIncoming = async () => {
    soundEffects.stopAll();
    const socket = getSocket();
    if (!socket?.connected || !currentCallId || !incomingCaller) return;

    setCallState("active");
    const stream = await setupLocalMedia();
    if (!stream) {
      handleRejectIncoming();
      return;
    }

    const pc = createPeerConnection(incomingCaller.id, currentCallId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // إنشاء Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("call:answer", {
      callId: currentCallId,
      toUserId: incomingCaller.id,
      sdp: answer,
    });
  };

  // 3. رفض مكالمة واردة (Reject Incoming Call)
  const handleRejectIncoming = () => {
    soundEffects.stopAll();
    soundEffects.playCallEndSound();
    const socket = getSocket();
    if (socket?.connected && currentCallId && incomingCaller) {
      socket.emit("call:reject", {
        callId: currentCallId,
        toUserId: incomingCaller.id,
      });
    }

    onCallLogged?.({
      id: `call_${Date.now()}`,
      type: "rejected",
      timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
      callerId: incomingCaller?.id || otherUser.id,
      callerName: incomingCaller?.name || otherUser.name,
    });

    cleanupCall();
    setCallState("idle");
  };

  // 4. إنهاء المكالمة بالكامل (End Call)
  const handleEndCall = () => {
    soundEffects.stopAll();
    soundEffects.playCallEndSound();
    const socket = getSocket();
    const targetUserId = incomingCaller?.id || otherUser.id;

    if (socket?.connected && currentCallId) {
      socket.emit("call:end", {
        callId: currentCallId,
        toUserId: targetUserId,
        durationSeconds,
      });
    }

    if (durationSeconds > 0) {
      onCallLogged?.({
        id: `call_${Date.now()}`,
        type: "completed",
        durationSeconds,
        timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        callerId: targetUserId,
        callerName: incomingCaller?.name || otherUser.name,
      });
    } else if (callState === "outgoing") {
      onCallLogged?.({
        id: `call_${Date.now()}`,
        type: "missed",
        timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        callerId: otherUser.id,
        callerName: otherUser.name,
      });
    }

    cleanupCall();
    setCallState("idle");
    setDurationSeconds(0);
  };

  // الرد السريع برسالة نصية
  const handleQuickReply = (message: string) => {
    onSendChatMessage?.(message);
    handleRejectIncoming();
  };

  // كتم أو تشغيل الميكروفون الفعلي
  const toggleMute = () => {
    const willMute = !isMuted;
    setIsMuted(willMute);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !willMute;
      });
    }
  };

  // التحكم بمخرج الصوت (Speaker)
  const toggleSpeaker = () => {
    const nextSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(nextSpeakerState);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !nextSpeakerState;
    }
  };

  // التحكم بعزل الضوضاء
  const toggleNoiseSuppression = () => {
    setIsNoiseSuppressionOn((prev) => !prev);
  };

  // عداد ثواني المكالمة النشطة
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

  // إطلاق المكالمة عند الضغط على زر الهاتف بالهيدر
  useEffect(() => {
    if (startCallTrigger && callState === "idle") {
      initiateOutgoingCall();
    }
  }, [startCallTrigger]);

  // الاستماع لأحداث الإشارات (Signaling Events) عبر السوكيت
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // اتصال وارد
    const onCallIncoming = async (data: any) => {
      if (callState !== "idle") {
        // إذا كنا بالفعل في مكالمة، الرد بأننا مشغولون
        socket.emit("call:reject", {
          callId: data.callId,
          toUserId: data.fromUserId,
          reason: "المستخدم مشغول حالياً",
        });
        return;
      }

      setCurrentCallId(data.callId);
      setIncomingCaller(data.caller);
      setCallState("incoming");
      soundEffects.startIncomingRingtone();

      // حفظ الـ SDP Offer
      if (data.sdp) {
        const pc = createPeerConnection(data.fromUserId, data.callId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    };

    // الطرف الآخر قبل المكالمة
    const onCallAnswered = async (data: any) => {
      if (data.callId === currentCallId || callState === "outgoing") {
        soundEffects.stopAll();
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
        if (peerConnectionRef.current && data.sdp) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
        setCallState("active");
      }
    };

    // استقبال مرشح ICE
    const onIceCandidate = async (data: any) => {
      try {
        if (peerConnectionRef.current && data.candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.warn("[WebRTC] Add ICE candidate error:", err);
      }
    };

    // الطرف الآخر رفض المكالمة
    const onCallRejected = () => {
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      cleanupCall();
      setCallState("idle");
      onCallLogged?.({
        id: `call_${Date.now()}`,
        type: "rejected",
        timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        callerId: otherUser.id,
        callerName: otherUser.name,
      });
    };

    // الطرف الآخر مشغول
    const onCallBusy = () => {
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      cleanupCall();
      setCallState("idle");
      onCallLogged?.({
        id: `call_${Date.now()}`,
        type: "busy",
        timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        callerId: otherUser.id,
        callerName: otherUser.name,
      });
    };

    // انتهاء المكالمة
    const onCallEnded = (data: any) => {
      soundEffects.stopAll();
      soundEffects.playCallEndSound();
      if (durationSeconds > 0 || (data?.durationSeconds && data.durationSeconds > 0)) {
        onCallLogged?.({
          id: `call_${Date.now()}`,
          type: "completed",
          durationSeconds: durationSeconds || data.durationSeconds,
          timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
          callerId: otherUser.id,
          callerName: otherUser.name,
        });
      }
      cleanupCall();
      setCallState("idle");
      setDurationSeconds(0);
    };

    socket.on("call:incoming", onCallIncoming);
    socket.on("call:answered", onCallAnswered);
    socket.on("call:ice_candidate", onIceCandidate);
    socket.on("call:rejected", onCallRejected);
    socket.on("call:busy", onCallBusy);
    socket.on("call:ended", onCallEnded);

    return () => {
      socket.off("call:incoming", onCallIncoming);
      socket.off("call:answered", onCallAnswered);
      socket.off("call:ice_candidate", onIceCandidate);
      socket.off("call:rejected", onCallRejected);
      socket.off("call:busy", onCallBusy);
      socket.off("call:ended", onCallEnded);
      cleanupCall();
    };
  }, [callState, currentCallId, durationSeconds, otherUser, cleanupCall]);

  return (
    <>
      {/* 1. إشعار المكالمة الواردة */}
      {callState === "incoming" && incomingCaller && (
        <IncomingCallModal
          caller={incomingCaller}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
          onQuickReply={handleQuickReply}
        />
      )}

      {/* 2. شاشة المكالمة الصادرة */}
      {callState === "outgoing" && (
        <OutgoingCallView
          user={otherUser}
          isRinging={isRinging}
          onCancel={handleEndCall}
        />
      )}

      {/* 3. شاشة المكالمة النشطة بالكامل */}
      {callState === "active" && (
        <ActiveCallView
          user={incomingCaller || otherUser}
          durationSeconds={durationSeconds}
          networkQuality={networkQuality}
          isMuted={isMuted}
          isSpeakerOn={isSpeakerOn}
          isNoiseSuppressionOn={isNoiseSuppressionOn}
          isSpeaking={isSpeaking}
          analyser={analyserRef.current}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onToggleNoiseSuppression={toggleNoiseSuppression}
          onMinimize={() => setCallState("minimized")}
          onEndCall={handleEndCall}
        />
      )}

      {/* 4. الوضع المصغر العائم PiP */}
      {callState === "minimized" && (
        <MiniCallWidget
          user={incomingCaller || otherUser}
          durationSeconds={durationSeconds}
          isMuted={isMuted}
          isSpeaking={isSpeaking}
          onMaximize={() => setCallState("active")}
          onToggleMute={toggleMute}
          onEndCall={handleEndCall}
        />
      )}
    </>
  );
};
export default VoiceCallManager;
