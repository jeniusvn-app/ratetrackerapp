import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RoomType } from '@/types';

export function useRoomTypes(hotelId: string | null | undefined) {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!hotelId) {
      setRoomTypes([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('room_types')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('display_order', { ascending: true });
    if (!error) setRoomTypes((data as RoomType[]) || []);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { roomTypes, loading, reload };
}
