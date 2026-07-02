"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Coins, Trophy, Loader2, Search, X, Check } from 'lucide-react';
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";

interface Gift {
  id: string;
  name: string;
  icon: string;
  price: number;
  category: string;
}

interface TopGift {
  name: string;
  icon: string;
  count: number;
}

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
};

const GiftStore = () => {
  const { onlineUsers } = useRealtimeStore();

  const [gifts, setGifts] = useState<Gift[]>([]);
  const [coins, setCoins] = useState(0);
  const [topGifts, setTopGifts] = useState<TopGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  // Send dialog
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<any>(null);

  const currentUser = getStoredUser();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [giftsRes, topRes] = await Promise.all([
        fetch("/api/gifts"),
        fetch("/api/gifts/top"),
      ]);
      const giftsData = await giftsRes.json();
      const topData = await topRes.json();

      if (giftsData.success) setGifts(giftsData.gifts);
      if (topData.success) setTopGifts(topData.topGifts);

      if (currentUser) {
        const coinsRes = await fetch(`/api/gifts/coins?userId=${currentUser.id}`);
        const coinsData = await coinsRes.json();
        if (coinsData.success) setCoins(coinsData.coins);
      }
    } catch (err) {
      console.error("Failed to fetch gift store data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openSendDialog = (gift: Gift) => {
    setSelectedGift(gift);
    setSelectedRecipient(null);
    setRecipientSearch("");
    setSendDialogOpen(true);
  };

  const handleSend = async () => {
    if (!selectedGift || !selectedRecipient || !currentUser) return;
    setSending(selectedGift.id);
    try {
      const res = await fetch("/api/gifts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: currentUser.id,
          receiverId: selectedRecipient.id,
          giftId: selectedGift.id,
          quantity: 1,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCoins(data.newBalance);
        showSuccess(`تم إرسال ${selectedGift.icon} ${selectedGift.name} إلى ${selectedRecipient.name || selectedRecipient.username}`);
        setSendDialogOpen(false);
        const topRes = await fetch("/api/gifts/top");
        const topData = await topRes.json();
        if (topData.success) setTopGifts(topData.topGifts);
      } else {
        showError(data.message);
      }
    } catch {
      showError("حدث خطأ أثناء إرسال الهدية");
    } finally {
      setSending(null);
    }
  };

  const filteredUsers = onlineUsers.filter((u: any) => {
    const name = (u.name || u.username || "").toLowerCase();
    return name.includes(recipientSearch.toLowerCase()) && u.id !== currentUser?.id;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full p-8">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-24 rtl">
      <div className="bg-gradient-to-r from-amber-400 to-yellow-600 p-6 rounded-3xl text-white shadow-lg shadow-yellow-500/20">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold mb-1">متجر الهدايا</h3>
            <p className="text-white/80 text-xs">أرسل الهدايا لأصدقائك لزيادة شعبيتهم</p>
          </div>
          <div className="bg-card/20 px-4 py-2 rounded-2xl backdrop-blur-sm flex items-center gap-2">
            <Coins size={20} className="text-yellow-200" />
            <span className="font-bold">{coins.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {gifts.map((gift) => (
          <Card key={gift.id} className="border-none shadow-sm rounded-2xl overflow-hidden hover:scale-[1.02] transition-transform">
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="text-5xl mb-4 transform hover:scale-110 transition-transform duration-300">
                {gift.icon}
              </div>
              <h4 className="font-bold text-foreground mb-1">{gift.name}</h4>
              <div className="flex items-center gap-1 text-amber-600 font-bold text-sm mb-4">
                <Coins size={14} />
                <span>{gift.price}</span>
              </div>
              <Button
                className="w-full rounded-xl h-9 text-xs font-bold"
                variant={gift.category === 'legendary' ? 'default' : 'secondary'}
                onClick={() => openSendDialog(gift)}
                disabled={sending === gift.id || !currentUser}
              >
                {sending === gift.id ? <Loader2 className="animate-spin" size={14} /> : "شراء وإهداء"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {topGifts.length > 0 && (
        <div className="bg-card p-4 rounded-2xl shadow-sm border border-border">
          <h4 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Trophy size={18} className="text-yellow-500" />
            أكثر الهدايا إرسالاً اليوم
          </h4>
          <div className="space-y-3">
            {topGifts.map((gift, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                  <span className="text-2xl">{gift.icon}</span>
                  <span className="font-medium text-foreground">{gift.name}</span>
                </div>
                <span className="text-muted-foreground text-xs">{gift.count.toLocaleString()} مرة</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              إرسال {selectedGift?.icon} {selectedGift?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {selectedGift && (
              <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl flex items-center justify-between">
                <span className="text-sm font-medium">التكلفة</span>
                <span className="font-bold text-amber-600 flex items-center gap-1">
                  <Coins size={14} /> {selectedGift.price}
                </span>
              </div>
            )}

            <div className="relative">
              <Search className="absolute right-3 top-2.5 text-muted-foreground" size={16} />
              <Input
                placeholder="ابحث عن مستلم..."
                className="pr-10 h-10 text-sm"
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                dir="rtl"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredUsers.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-4">لا يوجد مستخدمون</p>
              ) : (
                filteredUsers.map((user: any) => (
                  <button
                    key={user.id || user.socketId}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedRecipient?.id === user.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                    onClick={() => setSelectedRecipient(user)}
                  >
                    <Avatar className="w-11 h-11 rounded-lg">
                      <AvatarImage src={user.avatar || user.pic || "/pic.png"} />
                      <AvatarFallback className="text-[10px]">{(user.name || user.username)?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-right">
                      <p className="text-xs font-bold" style={user.nameColor && user.nameColor !== "#000000" ? { color: user.nameColor } : undefined}>{user.name || user.username}</p>
                    </div>
                    {selectedRecipient?.id === user.id && <Check size={16} className="text-primary" />}
                  </button>
                ))
              )}
            </div>

            <Button
              className="w-full h-11 rounded-xl font-bold"
              onClick={handleSend}
              disabled={!selectedRecipient || !!sending}
            >
              {sending ? <Loader2 className="animate-spin" size={16} /> : `إرسال إلى ${selectedRecipient?.name || selectedRecipient?.username || ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GiftStore;