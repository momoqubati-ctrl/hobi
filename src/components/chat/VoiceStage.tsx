import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Volume2, VolumeX, Lock, Unlock, LogOut, UserX, Shield, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { showSuccess, showError } from "@/utils/toast";

export interface VoiceSeat {
  seatIndex: number;
  userId: string;
  username: string;
  avatar: string;
  seatFrameUrl?: string;
  isMuted: boolean;
  isLocked: boolean;
  joinedAt: number;
}

interface VoiceStageProps {
  roomId: string;
  roomName?: string;
  currentUser: {
    id: string;
    username: string;
    role?: string;
    avatar?: string;
    seatFrameUrl?: string;
  };
  isVoiceChannel?: boolean;
  externalMuted?: boolean;
  onToggleExternalMute?: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

export const VoiceStage: React.FC<VoiceStageProps> = ({
  roomId,
  currentUser,
  isVoiceChannel = false,
  externalMuted,
  onToggleExternalMute,
}) => {
  const [seats, setSeats] = useState<(VoiceSeat | null)[]>([]);
  const [maxSeats, setMaxSeats] = useState<number>(isVoiceChannel ? 12 : 5);
  const [isStageMuted, setIsStageMuted] = useState<boolean>(Boolean(externalMuted));
  const [locallyMutedUsers, setLocallyMutedUsers] = useState<Set<string>>(new Set());
  const [isSpeakingUsers, setIsSpeakingUsers] = useState<Set<string>>(new Set());
  const [isSelfMuted, setIsSelfMuted] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [selectedSeatIndex, setSelectedSeatIndex] = useState<number | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const isMountedRef = useRef<boolean>(true);
  const isSelfMutedRef = useRef<boolean>(false);
  const isStageMutedRef = useRef<boolean>(Boolean(externalMuted));
  const locallyMutedUsersRef = useRef<Set<string>>(new Set());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceCandidateQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const speakingStateRef = useRef<boolean>(false);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitiatingRef = useRef<Set<string>>(new Set());
  const signalingQueuesRef = useRef<Map<string, Promise<void>>>(new Map());


  const mySeatIndex = seats.findIndex((s) => s?.userId === currentUser.id);
  const isOnStage = mySeatIndex !== -1;
  const isAdminOrOwner = ["admin", "owner", "moderator"].includes(currentUser.role || "");

  useEffect(() => {
    if (!isOnStage) return;
    const socket = getSocket();
    if (!socket) return;

    const heartbeat = () => socket.emit("voice_stage:heartbeat", { roomId });
    heartbeat();
    const intervalId = window.setInterval(heartbeat, 30000);
    return () => window.clearInterval(intervalId);
  }, [isOnStage, roomId]);

  // تنظيف وإنهاء كافة اتصالات الصوت
  const stopAllAudio = useCallback(() => {
    // إيقاف هالة التحدث ومؤقتاتها
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    if (speakingStateRef.current) {
      speakingStateRef.current = false;
      const socket = getSocket();
      socket?.emit("voice_stage:speaking", { roomId, isSpeaking: false });
    }

    isInitiatingRef.current.clear();
    signalingQueuesRef.current.clear();

    // إيقاف مسار المايك المحلي
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    // إغلاق كافة اتصالات الـ WebRTC مع الأطراف الأخرى
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    peerConnectionsRef.current.clear();
    iceCandidateQueuesRef.current.clear();
    setRemoteStreams(new Map());

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch {}
      audioContextRef.current = null;
    }
    audioElementsRef.current.clear();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsSpeakingUsers(new Set());
  }, [roomId]);

  // إنشاء أو الحصول على اتصال WebRTC مع طرف معين
  const getOrCreatePeerConnection = useCallback((peerUserId: string) => {
    let pc = peerConnectionsRef.current.get(peerUserId);
    if (!pc || pc.signalingState === "closed" || pc.connectionState === "closed") {
      pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(peerUserId, pc);

      pc.oniceconnectionstatechange = () => {
        console.log(`[VoiceStage] 🌐 ICE state with ${peerUserId}:`, pc?.iceConnectionState);
      };
      pc.onconnectionstatechange = () => {
        console.log(`[VoiceStage] 🔗 Connection state with ${peerUserId}:`, pc?.connectionState);
        if (pc?.connectionState === "closed" || pc?.connectionState === "failed") {
          peerConnectionsRef.current.delete(peerUserId);
          iceCandidateQueuesRef.current.delete(peerUserId);
          audioElementsRef.current.delete(peerUserId);
          setRemoteStreams((prev) => {
            if (!prev.has(peerUserId)) return prev;
            const next = new Map(prev);
            next.delete(peerUserId);
            return next;
          });
        }
      };

      // إرسال مرشحي ICE للطرف الآخر عبر السوكيت
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const socket = getSocket();
          socket?.emit("voice_stage:signal", {
            roomId,
            targetUserId: peerUserId,
            signal: { candidate: event.candidate },
          });
        }
      };

      // استقبال مسار الصوت من الطرف الآخر وتحديث الـ state
      pc.ontrack = (event) => {
        console.log("[VoiceStage] 🔊 ontrack received audio from:", peerUserId, event.track);
        const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(peerUserId, stream);
          return next;
        });

        const syncRemoteAudio = () => {
          const el = audioElementsRef.current.get(peerUserId);
          if (el) {
            if (el.srcObject !== stream) {
              el.srcObject = stream;
            }
            const shouldMute = locallyMutedUsersRef.current.has(peerUserId) || isStageMutedRef.current;
            el.muted = shouldMute;
            el.volume = 1.0;
            if (!shouldMute && el.paused) {
              el.play().catch(() => {});
            }
          }
        };

        syncRemoteAudio();

        event.track.onmute = () => {
          console.log("[VoiceStage] 🔇 track onmute from:", peerUserId);
        };

        event.track.onunmute = () => {
          console.log("[VoiceStage] 🔊 track onunmute (audio flowing) from:", peerUserId);
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(peerUserId, stream);
            return next;
          });
          syncRemoteAudio();
        };
      };
    }

    return pc;
  }, [roomId]);

  // بدء اتصال WebRTC مع عضو على الاستيج (للمتحدثين وللمستمعين)
  const initiateCallToPeer = useCallback(async (targetUserId: string, amIOnStage: boolean) => {
    if (targetUserId === currentUser.id) return;
    if (isInitiatingRef.current.has(targetUserId)) return;

    // بين متحدثين اثنين على الاستيج: صاحب المعرّف الأصغر فقط هو من يُنشئ الـ Offer لمنع التصادم
    if (amIOnStage) {
      const isOfferer = currentUser.id < targetUserId;
      if (!isOfferer) {
        return;
      }
    }

    isInitiatingRef.current.add(targetUserId);

    try {
      let pc = peerConnectionsRef.current.get(targetUserId);

      // إذا كان الاتصال قديماً وكان اتصال مستمع سابق ونحن الآن على الاستيج
      const hasLocalSender = pc ? pc.getSenders().some((s) => s.track && s.track.kind === "audio") : false;
      if (pc && (pc.connectionState === "closed" || pc.connectionState === "failed" || (amIOnStage && !hasLocalSender))) {
        try { pc.close(); } catch {}
        peerConnectionsRef.current.delete(targetUserId);
        iceCandidateQueuesRef.current.delete(targetUserId);
        pc = undefined;
      }

      const activePc = getOrCreatePeerConnection(targetUserId);

      // التأكد من إضافة مسار المايك المحلي قبل إنشاء الـ Offer إذا كنا على الاستيج
      if (amIOnStage && localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !isSelfMutedRef.current;
          const existingSender = activePc.getSenders().find((s) => s.track?.kind === "audio");
          if (!existingSender) {
            try { activePc.addTrack(audioTrack, localStreamRef.current); } catch {}
          } else if (existingSender.track !== audioTrack) {
            await existingSender.replaceTrack(audioTrack).catch(() => {});
          }
        }
      }

      // إذا كان الاتصال في حالة تفاوض جارية، نتجنب إرسال offer مكرر
      if (activePc.signalingState !== "stable") {
        return;
      }

      // إذا كان الاتصال متصلاً بنجاح ولديه إرسال محلي متوفر، لا داعي لإعادة الإرسال
      if (activePc.connectionState === "connected") {
        const activeSender = activePc.getSenders().some((s) => s.track && s.track.kind === "audio");
        if (!amIOnStage || activeSender) {
          return;
        }
      }

      const offer = await activePc.createOffer({
        offerToReceiveAudio: true,
      });
      await activePc.setLocalDescription(offer);

      const socket = getSocket();
      socket?.emit("voice_stage:signal", {
        roomId,
        targetUserId,
        signal: { sdp: activePc.localDescription },
      });
    } catch (err) {
      console.warn("[VoiceStage] Error initiating call to:", targetUserId, err);
    } finally {
      isInitiatingRef.current.delete(targetUserId);
    }
  }, [currentUser.id, getOrCreatePeerConnection, roomId]);

  // فك حظر الصوت التلقائي عند أول تفاعل من المستمع في الغرفة
  useEffect(() => {
    const unlockAudio = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (!audioContextRef.current || audioContextRef.current.state === "closed") {
            audioContextRef.current = new AudioCtx();
          }
          if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume().catch(() => {});
          }
        }
      } catch {}

      audioElementsRef.current.forEach((el, peerId) => {
        const isMutedNow = locallyMutedUsersRef.current.has(peerId) || isStageMutedRef.current;
        el.muted = isMutedNow;
        if (!isMutedNow && el.paused && el.srcObject) {
          el.play().catch(() => {});
        }
      });
    };
    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  // مزامنة حالة كتم الصوت من زر هيدر الغرفة الخارجي
  useEffect(() => {
    if (externalMuted !== undefined) {
      setIsStageMuted(externalMuted);
      isStageMutedRef.current = externalMuted;

      audioElementsRef.current.forEach((el, peerId) => {
        const isMutedNow = locallyMutedUsersRef.current.has(peerId) || externalMuted;
        el.muted = isMutedNow;
        if (!isMutedNow && el.paused && el.srcObject) {
          el.play().catch(() => {});
        }
      });
    }
  }, [externalMuted]);

  // تشغيل المايك المحلي وتتبع مستوى الصوت
  const startLocalMicrophone = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    // فحص إمكانية الوصول إلى المايك
    if (!navigator?.mediaDevices?.getUserMedia) {
      showError("المتصفح يحتاج لتفعيل إذن المايك في الشبكة المحلية أو تفعيل HTTPS");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;

      // رصد مستوى الصوت المحلي لتحريك هالة التحدث ومزامنتها لحظياً
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (!audioContextRef.current || audioContextRef.current.state === "closed") {
            audioContextRef.current = new AudioCtx();
          }
          const ctx = audioContextRef.current;
          if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
          }
          const analyser = ctx.createAnalyser();
          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);
          analyser.fftSize = 256;
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkVolume = () => {
            if (!localStreamRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;

            const isNowSpeaking = avg > 16 && !isSelfMutedRef.current;
            if (isNowSpeaking !== speakingStateRef.current) {
              if (isNowSpeaking) {
                if (speakingTimeoutRef.current) {
                  clearTimeout(speakingTimeoutRef.current);
                  speakingTimeoutRef.current = null;
                }
                speakingStateRef.current = true;
                setIsSpeakingUsers((prev) => {
                  const next = new Set(prev);
                  next.add(currentUser.id);
                  return next;
                });
                const socket = getSocket();
                socket?.emit("voice_stage:speaking", { roomId, isSpeaking: true });
              } else {
                if (!speakingTimeoutRef.current) {
                  speakingTimeoutRef.current = setTimeout(() => {
                    speakingStateRef.current = false;
                    speakingTimeoutRef.current = null;
                    setIsSpeakingUsers((prev) => {
                      const next = new Set(prev);
                      next.delete(currentUser.id);
                      return next;
                    });
                    const socket = getSocket();
                    socket?.emit("voice_stage:speaking", { roomId, isSpeaking: false });
                  }, 350);
                }
              }
            }

            animFrameRef.current = requestAnimationFrame(checkVolume);
          };
          checkVolume();
        }
      } catch (e) {
        console.warn("[VoiceStage] AudioContext monitoring fallback:", e);
      }

      // إضافة المايك المحلي لجميع الاتصالات القائمة
      peerConnectionsRef.current.forEach((pc) => {
        const senders = pc.getSenders();
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !isSelfMutedRef.current;
          const existingSender = senders.find((s) => s.track?.kind === "audio");
          if (existingSender) {
            existingSender.replaceTrack(track).catch(() => {});
          } else {
            try {
              pc.addTrack(track, stream);
            } catch {}
          }
        });
      });

      return stream;
    } catch (err: any) {
      console.warn("[VoiceStage] getUserMedia error:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        showError("تم رفض إذن المايكروفون في المتصفح");
      } else {
        showError("تعذر فتح المايكروفون، تأكد من إعدادات المتصفح");
      }
      return null;
    }
  }, [currentUser.id, roomId]);

  // 1. مزامنة مقاعد الاستيج ومستمعي إشارات WebRTC
  useEffect(() => {
    isMountedRef.current = true;
    const socket = getSocket();
    if (!socket) return;

    // طلب المقاعد الحالية فور فتح الغرفة والاستماع الفوري للمتحدثين
    socket.emit("voice_stage:get_seats", { roomId }, (res: any) => {
      if (res?.success && isMountedRef.current) {
        setSeats(res.seats || []);
        if (res.maxSeats) setMaxSeats(res.maxSeats);

        const amIOnStage = (res.seats || []).some((s: any) => s?.userId === currentUser.id);

        // بدء الاستماع فوراً لأي متحدث موجود على الاستيج
        (res.seats || []).forEach((seat: VoiceSeat | null) => {
          if (seat && seat.userId && seat.userId !== currentUser.id) {
            initiateCallToPeer(seat.userId, amIOnStage);
          }
        });
      }
    });

    const onSeatsUpdated = (data: { roomId: string; seats: (VoiceSeat | null)[]; maxSeats: number }) => {
      if (data.roomId === roomId && isMountedRef.current) {
        setSeats(data.seats || []);
        if (data.maxSeats) setMaxSeats(data.maxSeats);

        // هل أنا على الاستيج وفق بيانات المقاعد الحالية المؤكدة؟
        const amIOnStage = (data.seats || []).some((s) => s?.userId === currentUser.id);

        const activeUsersOnStage = new Set(
          (data.seats || [])
            .filter(Boolean)
            .map((s) => s!.userId)
            .filter((id) => id !== currentUser.id)
        );

        // إزالة الصوت البعيد لأي عضو لم يعد على الاستيج
        setRemoteStreams((prev) => {
          let hasChanges = false;
          const next = new Map(prev);
          for (const peerId of next.keys()) {
            if (!activeUsersOnStage.has(peerId)) {
              next.delete(peerId);
              hasChanges = true;
            }
          }
          return hasChanges ? next : prev;
        });

        // إغلاق الاتصالات مع المتحدثين الذين غادروا الاستيج
        peerConnectionsRef.current.forEach((pc, peerId) => {
          if (!activeUsersOnStage.has(peerId)) {
            try { pc.close(); } catch {}
            peerConnectionsRef.current.delete(peerId);
            iceCandidateQueuesRef.current.delete(peerId);
          }
        });

        // ربط الاتصال مع كل متحدث على الاستيج (للمستمعين وللمتحدثين)
        (data.seats || []).forEach((seat) => {
          if (seat && seat.userId && seat.userId !== currentUser.id) {
            initiateCallToPeer(seat.userId, amIOnStage);
          }
        });
      }
    };

    // استقبال إشارات WebRTC (Offer / Answer / ICE Candidates) من الطرف الآخر بتسلسل محمي
    const onWebRTCSignal = (data: { roomId: string; fromUserId: string; signal: any }) => {
      if (data.roomId !== roomId) return;
      const { fromUserId, signal } = data;
      if (!fromUserId || !signal) return;

      const prevQueue = signalingQueuesRef.current.get(fromUserId) || Promise.resolve();
      const nextQueue = prevQueue.then(async () => {
        try {
          if (signal.sdp) {
            const sdp = new RTCSessionDescription(signal.sdp);

            if (sdp.type === "offer") {
              // عند وصول عرض جديد (Offer):
              let pc = peerConnectionsRef.current.get(fromUserId);
              if (pc && (pc.connectionState === "closed" || pc.connectionState === "failed" || pc.signalingState !== "stable")) {
                try { pc.close(); } catch {}
                peerConnectionsRef.current.delete(fromUserId);
                iceCandidateQueuesRef.current.delete(fromUserId);
                pc = undefined;
              }

              if (!pc) {
                pc = getOrCreatePeerConnection(fromUserId);
              }

              // الخطوة 1: ضبط الوصف البعيد أولاً لإنشاء transceivers مطابقة بدقة للعرض
              await pc.setRemoteDescription(sdp);

              // الخطوة 2: ربط المايك المحلي مع مسار الصوت في الاتصال بعد ضبط الوصف البعيد
              if (localStreamRef.current) {
                const audioTrack = localStreamRef.current.getAudioTracks()[0];
                if (audioTrack) {
                  audioTrack.enabled = !isSelfMutedRef.current;
                  const senders = pc.getSenders();
                  const audioSender = senders.find((s) => s.track?.kind === "audio");
                  if (audioSender) {
                    await audioSender.replaceTrack(audioTrack).catch(() => {});
                  } else {
                    try { pc.addTrack(audioTrack, localStreamRef.current!); } catch {}
                  }
                }
              }

              // تطبيق أي ICE Candidates كانت معلقة بالانتظار
              const queued = iceCandidateQueuesRef.current.get(fromUserId) || [];
              for (const cand of queued) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
              iceCandidateQueuesRef.current.delete(fromUserId);

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              socket.emit("voice_stage:signal", {
                roomId,
                targetUserId: fromUserId,
                signal: { sdp: pc.localDescription },
              });
            } else if (sdp.type === "answer") {
              const pc = peerConnectionsRef.current.get(fromUserId);
              if (pc && pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(sdp);

                const queued = iceCandidateQueuesRef.current.get(fromUserId) || [];
                for (const cand of queued) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
                iceCandidateQueuesRef.current.delete(fromUserId);
              }
            }
          } else if (signal.candidate) {
            const pc = peerConnectionsRef.current.get(fromUserId);
            if (pc && pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
            } else {
              const queue = iceCandidateQueuesRef.current.get(fromUserId) || [];
              queue.push(signal.candidate);
              iceCandidateQueuesRef.current.set(fromUserId, queue);
            }
          }
        } catch (err) {
          console.warn("[VoiceStage] Signal handling error with:", fromUserId, err);
        }
      });

      signalingQueuesRef.current.set(fromUserId, nextQueue);
    };

    const onKicked = (data: { roomId: string }) => {
      if (data.roomId === roomId && isMountedRef.current) {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
        }
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        setIsSpeakingUsers((prev) => {
          const next = new Set(prev);
          next.delete(currentUser.id);
          return next;
        });
        peerConnectionsRef.current.forEach((pc) => {
          try {
            pc.getSenders().forEach((s) => {
              if (s.track?.kind === "audio") s.replaceTrack(null).catch(() => {});
            });
          } catch {}
        });
        setIsSelfMuted(false);
        showError("تم إنزالك من المايك بواسطة الإدارة");
      }
    };

    const onUserLeft = (data: { socketId?: string; username?: string; userId?: string }) => {
      if (data?.userId && peerConnectionsRef.current.has(data.userId)) {
        try {
          peerConnectionsRef.current.get(data.userId)?.close();
        } catch {}
        peerConnectionsRef.current.delete(data.userId);
        iceCandidateQueuesRef.current.delete(data.userId);
        setRemoteStreams((prev) => {
          if (!prev.has(data.userId!)) return prev;
          const next = new Map(prev);
          next.delete(data.userId!);
          return next;
        });
      }
    };

    const onUserSpeaking = (data: { roomId: string; userId: string; isSpeaking: boolean }) => {
      if (isMountedRef.current && data?.userId) {
        const uidStr = String(data.userId);
        setIsSpeakingUsers((prev) => {
          const next = new Set(prev);
          if (data.isSpeaking) {
            next.add(data.userId);
            next.add(uidStr);
          } else {
            next.delete(data.userId);
            next.delete(uidStr);
          }
          return next;
        });
      }
    };

    socket.on("voice_stage:seats_updated", onSeatsUpdated);
    socket.on("voice_stage:signal", onWebRTCSignal);
    socket.on("voice_stage:kicked_from_seat", onKicked);
    socket.on("voice_stage:user_speaking", onUserSpeaking);
    socket.on("user_left", onUserLeft);

    return () => {
      isMountedRef.current = false;
      socket.off("voice_stage:seats_updated", onSeatsUpdated);
      socket.off("voice_stage:signal", onWebRTCSignal);
      socket.off("voice_stage:kicked_from_seat", onKicked);
      socket.off("voice_stage:user_speaking", onUserSpeaking);
      socket.off("user_left", onUserLeft);

      // إشعار الخادم بإخلاء المقعد فوراً عند مغادرة الغرفة أو الانتقال لغرفة أخرى
      socket.emit("voice_stage:leave_seat", { roomId });

      stopAllAudio();
    };
  }, [roomId, currentUser.id, getOrCreatePeerConnection, initiateCallToPeer, stopAllAudio]);

  // 2. الصعود على مقعد فارغ مباشرة بالصلاحية
  const handleTakeSeat = async (seatIndex: number) => {
    const socket = getSocket();
    if (!socket) {
      showError("لا يوجد اتصال بالخادم");
      return;
    }

    // 1. تفعيل المايك مسبقاً قبل إرسال الطلب للسيرفر لضمان وجود مسار الصوت
    const stream = await startLocalMicrophone();
    if (!stream) {
      return;
    }

    // تنظيف اتصالات الاستماع السابقة للبدء باتصالات متحدثين نقية ثنائية الاتجاه
    peerConnectionsRef.current.forEach((pc) => {
      try { pc.close(); } catch {}
    });
    peerConnectionsRef.current.clear();
    iceCandidateQueuesRef.current.clear();
    setRemoteStreams(new Map());

    // 2. فك قفل سياق الصوت التلقائي بالمتصفح
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const dummy = new AudioCtx();
        if (dummy.state === "suspended") {
          dummy.resume();
        }
      }
    } catch {}

    let responded = false;
    const timeout = setTimeout(() => {
      if (!responded) {
        showError("لم يستجب الخادم، تأكد من تحديث الصفحة");
      }
    }, 4000);

    socket.emit("voice_stage:take_seat", { roomId, seatIndex }, async (res: any) => {
      responded = true;
      clearTimeout(timeout);
      if (res?.success) {
        showSuccess(`صعدت على المقعد ${seatIndex + 1} بنجاح! 🎙️`);
        if (res.payload?.seats) {
          setSeats(res.payload.seats);
          if (res.payload.maxSeats) setMaxSeats(res.payload.maxSeats);
        }

        // بدء الاتصال الصوتي مع بقية الأعضاء الموجودين مسبقاً على الاستيج
        if (res.payload?.seats) {
          res.payload.seats.forEach((seat: VoiceSeat | null) => {
            if (seat && seat.userId && seat.userId !== currentUser.id) {
              initiateCallToPeer(seat.userId, true);
            }
          });
        }
      } else {
        showError(res?.message || "تعذر الصعود على المقعد");
      }
    });
  };

  // 3. النزول من المقعد
  const handleLeaveSeat = async () => {
    const socket = getSocket();
    if (!socket) return;

    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    if (speakingStateRef.current) {
      speakingStateRef.current = false;
      socket.emit("voice_stage:speaking", { roomId, isSpeaking: false });
    }

    // 1. إيقاف المايك المحلي للمستخدم فقط
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsSpeakingUsers((prev) => {
      const next = new Set(prev);
      next.delete(currentUser.id);
      return next;
    });
    setIsSelfMuted(false);
    isSelfMutedRef.current = false;

    // 2. تنظيف اتصالات التحدث السابقة للتحول إلى وضع المستمع النقي
    peerConnectionsRef.current.forEach((pc) => {
      try { pc.close(); } catch {}
    });
    peerConnectionsRef.current.clear();
    iceCandidateQueuesRef.current.clear();
    setRemoteStreams(new Map());

    // 3. إشعار الخادم بالنزول من المقعد وإعادة الاتصال كمستمع
    socket.emit("voice_stage:leave_seat", { roomId }, async (res: any) => {
      if (res?.success) {
        showSuccess("تم النزول من المقعد - تستطيع مواصلة الاستماع 🎧");
        (seats || []).forEach((seat) => {
          if (seat && seat.userId && seat.userId !== currentUser.id) {
            initiateCallToPeer(seat.userId, false);
          }
        });
      }
    });
  };

  // 4. كتم / إلغاء كتم مايك المتحدث لنفسه
  const handleToggleSelfMute = async () => {
    const nextMuted = !isSelfMuted;
    setIsSelfMuted(nextMuted);
    isSelfMutedRef.current = nextMuted;

    if (nextMuted) {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      if (speakingStateRef.current) {
        speakingStateRef.current = false;
        const socket = getSocket();
        socket?.emit("voice_stage:speaking", { roomId, isSpeaking: false });
      }
      setIsSpeakingUsers((prev) => {
        const next = new Set(prev);
        next.delete(currentUser.id);
        return next;
      });
    }

    if (localStreamRef.current) {
      let audioTracks = localStreamRef.current.getAudioTracks();

      // إذا كان المسار منتهياً أو متوقفاً عند إلغاء الكتم، نعيد جلب المايك لضمان عودة الصوت
      if (!nextMuted && (audioTracks.length === 0 || audioTracks.some((t) => t.readyState === "ended"))) {
        try {
          const freshStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          localStreamRef.current = freshStream;
          audioTracks = freshStream.getAudioTracks();

          if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            try {
              const source = audioContextRef.current.createMediaStreamSource(freshStream);
              if (analyserRef.current) {
                source.connect(analyserRef.current);
              }
            } catch {}
          }
        } catch (e) {
          console.warn("[VoiceStage] Failed to re-acquire microphone stream on unmute:", e);
        }
      }

      audioTracks.forEach((track) => {
        track.enabled = !nextMuted;
      });

      // إيقاظ وبث المسار الصوتي فورياً على جميع الـ RTCRtpSenders
      const activeTrack = audioTracks[0];
      if (activeTrack) {
        peerConnectionsRef.current.forEach((pc) => {
          pc.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === "audio") {
              sender.track.enabled = !nextMuted;
              if (!nextMuted) {
                sender.replaceTrack(activeTrack).catch(() => {});
              }
            }
          });
        });
      }
    }

    // إيقاظ AudioContext عند إلغاء الكتم
    if (!nextMuted && audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }

    const socket = getSocket();
    if (socket) {
      socket.emit("voice_stage:toggle_mute", { roomId, isMuted: nextMuted });
    }
  };

  // 5. كتم شخص محدد محلياً من جهة المستمع فقط
  const toggleLocalMuteUser = (userId: string) => {
    setLocallyMutedUsers((prev) => {
      const next = new Set(prev);
      const isMuting = !next.has(userId);
      if (isMuting) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      locallyMutedUsersRef.current = next;

      // تطبيق فوري على عنصر الصوت الخاص بهذا العضو
      const el = audioElementsRef.current.get(userId);
      if (el) {
        const shouldMute = isMuting || isStageMutedRef.current;
        el.muted = shouldMute;
        if (!shouldMute && el.paused) {
          el.play().catch((e) => console.warn("[VoiceStage] Audio resume user failed:", e));
        }
      }

      return next;
    });
  };

  // 6. كتم كل أصوات الاستيج عني فقط / أو إلغاء كتمها
  const toggleStageMuteAll = () => {
    const nextStageMuted = !isStageMuted;
    setIsStageMuted(nextStageMuted);
    isStageMutedRef.current = nextStageMuted;
    onToggleExternalMute?.();

    // تحديث ومزامنة جميع عناصر الصوت
    audioElementsRef.current.forEach((el, peerId) => {
      const isMutedNow = locallyMutedUsersRef.current.has(peerId) || nextStageMuted;
      el.muted = isMutedNow;
      if (!isMutedNow && el.paused) {
        el.play().catch((e) => console.warn("[VoiceStage] Audio resume on unmute failed:", e));
      }
    });

    if (!nextStageMuted) {
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    }
  };

  // 7. أوامر الإدارة (قفل المقعد وإنزال العضو)
  const handleAdminLockSeat = (seatIndex: number, currentLocked: boolean) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit("voice_stage:admin_lock_seat", { roomId, seatIndex, isLocked: !currentLocked });
  };

  const handleAdminKickSeat = (seatIndex: number) => {
    const socket = getSocket();
    if (!socket) return;
    if (confirm("هل تريد إنزال هذا العضو من المايك؟")) {
      socket.emit("voice_stage:admin_kick_seat", { roomId, seatIndex });
    }
  };

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white select-none transition-all duration-300">
      {/* الشريط العلوي للتحكم والحالة */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-semibold text-emerald-400">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            {isVoiceChannel ? "القناة الصوتية الكبرى" : "الاستيج الصوتي"}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
            {seats.filter(Boolean).length} / {maxSeats} مقاعد
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* زر كتم الاستيج بالكامل محلياً للمستمع */}
          <button
            onClick={toggleStageMuteAll}
            title={isStageMuted ? "إلغاء كتم الاستيج" : "كتم صوت الاستيج من جهتي"}
            className={`p-1 rounded-md transition-colors ${
              isStageMuted ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-slate-800 hover:bg-slate-700 text-slate-300"
            }`}
          >
            {isStageMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* زر طي / فتح الاستيج لتوفير مساحة للشات */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400"
            title={isCollapsed ? "عرض المقاعد" : "تصغير الاستيج"}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* منطقة عرض المقاعد */}
      {!isCollapsed && (
        <div className="p-3">
          <div
            className={`grid gap-3 justify-center items-center ${
              isVoiceChannel
                ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8"
                : "grid-cols-5"
            }`}
          >
            {Array.from({ length: maxSeats }).map((_, index) => {
              const seat = seats[index];
              const isOccupied = Boolean(seat?.userId);
              const isSpeaking = seat?.userId ? (isSpeakingUsers.has(seat.userId) || isSpeakingUsers.has(String(seat.userId))) : false;
              const isLocallyMuted = seat?.userId ? locallyMutedUsers.has(seat.userId) : false;
              const isMe = seat?.userId === currentUser.id;

              return (
                <div key={index} className="flex flex-col items-center group relative">
                  {/* حاوية المقعد مع دعم الإطار الصوتي الخاص */}
                  <div
                    onClick={() => {
                      if (!isOccupied && !seat?.isLocked) {
                        handleTakeSeat(index);
                      } else {
                        setSelectedSeatIndex(selectedSeatIndex === index ? null : index);
                      }
                    }}
                    className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center cursor-pointer transition-all transform hover:scale-105 ${
                      isOccupied
                        ? "bg-slate-800"
                        : seat?.isLocked
                        ? "bg-slate-800/40 border border-dashed border-red-500/40"
                        : "bg-slate-800/60 border border-dashed border-slate-600 hover:border-emerald-400 hover:bg-slate-800"
                    } ${
                      isSpeaking
                        ? "ring-4 ring-emerald-400 ring-offset-2 ring-offset-slate-900 shadow-[0_0_16px_rgba(52,211,153,0.7)] animate-pulse"
                        : ""
                    }`}
                  >
                    {isOccupied && seat ? (
                      <>
                        {/* صورة العضو */}
                        <img
                          src={seat.avatar || "/pic.png"}
                          alt={seat.username}
                          className="w-full h-full rounded-full object-cover"
                        />

                        {/* إطار المقعد الصوتي المميز (Seat Frame) */}
                        {seat.seatFrameUrl && (
                          <img
                            src={seat.seatFrameUrl}
                            alt="Seat Frame"
                            className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] max-w-none pointer-events-none object-contain z-10"
                          />
                        )}

                        {/* رمز المايك وحالة الكتم */}
                        <div className="absolute -bottom-1 -right-1 z-20 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow">
                          {seat.isMuted ? (
                            <span className="bg-red-500 text-white rounded-full p-0.5" title="مكتوم">
                              <MicOff className="w-2.5 h-2.5" />
                            </span>
                          ) : (
                            <span className="bg-emerald-500 text-white rounded-full p-0.5" title="المايك مفتوح">
                              <Mic className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>

                        {/* مؤشر الكتم المحلي من المستمع */}
                        {isLocallyMuted && (
                          <div className="absolute -top-1 -right-1 z-20 bg-amber-500 text-black rounded-full p-0.5" title="كتمته من جهتك">
                            <VolumeX className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </>
                    ) : seat?.isLocked ? (
                      <Lock className="w-4 h-4 text-red-400" />
                    ) : (
                      <span className="text-slate-400 font-bold text-xs group-hover:text-emerald-400 transition-colors">
                        +
                      </span>
                    )}

                    {/* رقم المقعد */}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-slate-900/90 border border-slate-700 text-slate-400 z-20">
                      {index + 1}
                    </span>
                  </div>

                  {/* اسم صاحب المقعد أو شاغر */}
                  <span className="mt-1 text-[10px] text-slate-300 font-medium truncate max-w-[56px] text-center">
                    {isOccupied && seat ? seat.username : seat?.isLocked ? "مقفل" : "شاغر"}
                  </span>

                  {/* نافذة الإجراءات المنبثقة عند النقر على المقعد */}
                  {selectedSeatIndex === index && (
                    <div className="absolute top-16 z-30 bg-slate-800 border border-slate-700 shadow-2xl rounded-lg p-2 min-w-[130px] flex flex-col gap-1 text-[11px] animate-in fade-in zoom-in-95">
                      {isOccupied && seat ? (
                        <>
                          {/* كتم من جهتي للمستمع */}
                          {!isMe && (
                            <button
                              onClick={() => toggleLocalMuteUser(seat.userId)}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-700 text-right ${
                                isLocallyMuted ? "text-amber-400" : "text-slate-300"
                              }`}
                            >
                              {isLocallyMuted ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                              {isLocallyMuted ? "إلغاء كتمه من جهتي" : "كتم من جهتي 🔇"}
                            </button>
                          )}

                          {/* إجراءات الإدارة */}
                          {isAdminOrOwner && !isMe && (
                            <button
                              onClick={() => handleAdminKickSeat(index)}
                              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-red-500/20 text-red-400 text-right"
                            >
                              <UserX className="w-3 h-3" />
                              إنزال من المايك
                            </button>
                          )}
                        </>
                      ) : null}

                      {/* قفل / فتح المقعد للإدارة */}
                      {isAdminOrOwner && (
                        <button
                          onClick={() => handleAdminLockSeat(index, Boolean(seat?.isLocked))}
                          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-700 text-slate-300 text-right border-t border-slate-700/60 pt-1"
                        >
                          {seat?.isLocked ? <Unlock className="w-3 h-3 text-emerald-400" /> : <Lock className="w-3 h-3 text-red-400" />}
                          {seat?.isLocked ? "فتح المقعد" : "قفل المقعد 🔒"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* لوحة تحكم المتحدث عندما يكون صاعداً على المايك */}
          {isOnStage && (
            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between px-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                أنت على المايك الآن (المقعد {mySeatIndex + 1})
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleSelfMute}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors ${
                    isSelfMuted
                      ? "bg-red-500 hover:bg-red-600 text-white"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {isSelfMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {isSelfMuted ? "المايك مكتوم (انقر للتحدث)" : "المايك مفتوح (تحدث الآن)"}
                </button>

                <button
                  onClick={handleLeaveSeat}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400 transition-colors"
                  title="النزول من المايك"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  نزول
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* مشغلات الصوت للأعضاء الآخرين على الاستيج داخل الـ DOM المباشر لضمان استمرار الصوت حتى عند طي الاستيج */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
        {Array.from(remoteStreams.entries()).map(([peerId, stream]) => {
          const isLocallyMuted = locallyMutedUsers.has(peerId) || isStageMuted;
          return (
            <audio
              key={peerId}
              id={`remote-audio-${peerId}`}
              ref={(el) => {
                if (el) {
                  audioElementsRef.current.set(peerId, el);
                  if (el.srcObject !== stream) {
                    el.srcObject = stream;
                  }
                  el.muted = isLocallyMuted;
                  el.volume = 1.0;
                  if (!isLocallyMuted && el.paused) {
                    el.play().catch((e) => console.warn("[VoiceStage] Audio play catch:", e));
                  }
                } else {
                  audioElementsRef.current.delete(peerId);
                }
              }}
              onPause={(e) => {
                const el = e.currentTarget;
                const isMutedNow = locallyMutedUsersRef.current.has(peerId) || isStageMutedRef.current;
                if (!isMutedNow && el.paused && el.srcObject) {
                  el.play().catch(() => {});
                }
              }}
              onEnded={(e) => {
                const el = e.currentTarget;
                if (el.srcObject) {
                  el.play().catch(() => {});
                }
              }}
              autoPlay
              playsInline
              controls={false}
            />
          );
        })}
      </div>
    </div>
  );
};
