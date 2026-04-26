import { Link } from 'react-router-dom';
import { ListMusic, Heart } from 'lucide-react';
import type { Playlist } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';

interface PlaylistCardProps {
  playlist: Playlist;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="group block transition-transform duration-300 hover:-translate-y-0.5"
    >
      <Card className="border-transparent bg-card/70 transition-all duration-300 group-hover:border-primary/30">
        <CardContent className="flex items-center gap-4 p-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${playlist.isLiked ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
            {playlist.isLiked ? <Heart size={22} fill="currentColor" /> : <ListMusic size={22} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{playlist.name}</p>
            <p className="text-xs text-muted-foreground">
              {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
