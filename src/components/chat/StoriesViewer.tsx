"use client";

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Play } from 'lucide-react';

const MOCK_STORIES = [
  { id: 1, user: 'أحمد', avatar: 'https://i.pravatar.cc/150?u=11', image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&q=80', viewed: false },
  { id: 2, user: 'سارة', avatar: 'https://i.pravatar.cc/150?u=12', image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80', viewed: true },
  { id: 3, user: 'خالد', avatar: 'https://i.pravatar.cc/150?u=13', image: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&q=80', viewed: false },
  { id: 4, user: 'ليلى', avatar: 'https://i.pravatar.cc/150?u=14', image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80', viewed: true },
];

const StoriesViewer = () => {
  return (
    <div className="p-4 space-y-6 rtl">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-slate-200">القصص اليومية</h3>
        <button className="text-xs text-primary font-bold">مشاهدة الكل</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-slate-800 border border-white/5 group cursor-pointer">
          <img 
            src="https://i.pravatar.cc/150?u=me" 
            className="w-full h-full object-cover opacity-50 group-hover:scale-110 transition-transform duration-500" 
            alt="my story"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
              <Plus size={20} className="text-white" />
            </div>
            <span className="text-[10px] font-bold text-white">إضافة قصة</span>
          </div>
        </div>

        {MOCK_STORIES.map((story) => (
          <div key={story.id} className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-white/5 group cursor-pointer">
            <img 
              src={story.image} 
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
              alt={story.user}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
            
            <div className="absolute top-2 right-2">
              <div className={`p-0.5 rounded-full border-2 ${story.viewed ? 'border-slate-400' : 'border-primary'}`}>
                <Avatar className="w-11 h-11 border border-black/20">
                  <AvatarImage src={story.avatar} />
                  <AvatarFallback>{story.user[0]}</AvatarFallback>
                </Avatar>
              </div>
            </div>

            <div className="absolute bottom-3 right-3 left-3">
              <p className="text-[11px] font-bold text-white truncate">{story.user}</p>
            </div>
            
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-10 h-10 bg-card/20 backdrop-blur-md rounded-full flex items-center justify-center">
                <Play size={20} className="text-white fill-current" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StoriesViewer;