import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadProductImage } from '@/lib/uploadImage';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';

interface Props {
  value: string;
  onChange: (url: string) => void;
}

export default function ImageUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Выберите изображение');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл больше 5 МБ');
      return;
    }

    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      onChange(url);
    } catch (e) {
      console.error(e);
      setError('Ошибка загрузки: ' + (e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeImage = async () => {
    if (value && value.includes('/product-images/')) {
      const path = value.split('/product-images/')[1];
      if (path) {
        await supabase.storage.from('product-images').remove([path]).catch(() => {});
      }
    }
    onChange('');
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-gray-500">
        Изображение
      </label>

      {value ? (
        <div className="relative h-40 w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <img src={value} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={removeImage}
            className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-500 shadow hover:bg-white"
          >
            <X size={16} />
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-2 right-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-gray-700 shadow hover:bg-white"
          >
            Заменить
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-all hover:border-orange-400 hover:bg-orange-50 hover:text-orange-500 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm font-semibold">Загрузка…</span>
            </>
          ) : (
            <>
              <ImageIcon size={32} />
              <span className="flex items-center gap-1 text-sm font-semibold">
                <Upload size={14} /> Выбрать фото
              </span>
              <span className="text-xs">PNG, JPG · до 5 МБ</span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}