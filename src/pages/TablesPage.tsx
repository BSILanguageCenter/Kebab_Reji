import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { RestaurantTable, TableStatus } from '@/lib/types';
import { tableStatusColors } from '@/lib/format';
import { Plus, Trash2, X } from 'lucide-react';

export default function TablesPage() {
  const { t, lang } = useI18n();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    loadTables();
    const channel = supabase
      .channel('tables-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, () => loadTables())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadTables() {
    const { data } = await supabase.from('restaurant_tables').select('*').order('sort_order');
    if (data) setTables(data as RestaurantTable[]);
  }

  const addTable = async () => {
    if (!newName.trim()) return;
    await supabase.from('restaurant_tables').insert({
      name: newName.trim(),
      status: 'free' as TableStatus,
      sort_order: tables.length + 1,
    });
    setNewName('');
    setShowForm(false);
    loadTables();
  };

  const deleteTable = async (id: string) => {
    if (!confirm(t('tables.deleteConfirm'))) return;
    await supabase.from('restaurant_tables').delete().eq('id', id);
    loadTables();
  };

  const cycleStatus = async (table: RestaurantTable) => {
    const next: Record<TableStatus, TableStatus> = {
      free: 'occupied',
      occupied: 'waiting_payment',
      waiting_payment: 'free',
    };
    await supabase.from('restaurant_tables').update({ status: next[table.status] }).eq('id', table.id);
    loadTables();
  };

  return (
    <div className="h-full p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">{t('tables.title')}</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex h-12 items-center gap-2 rounded-xl bg-gray-800 px-4 font-semibold text-white hover:bg-gray-900"
        >
          <Plus size={20} />
          {t('tables.addTable')}
        </button>
      </div>

      {tables.length === 0 ? (
        <p className="text-gray-400">{t('tables.noTables')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {tables.map((table) => (
            <div
              key={table.id}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-6 ${tableStatusColors[table.status]}`}
            >
              <p className="text-2xl font-bold">{table.name}</p>
              <button
                onClick={() => cycleStatus(table)}
                className="rounded-xl bg-white/60 px-3 py-1.5 text-sm font-semibold hover:bg-white/80"
              >
                {t(`tableStatus.${table.status}`)}
              </button>
              <button
                onClick={() => deleteTable(table.id)}
                className="text-gray-400 hover:text-red-500"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">{t('tables.addTable')}</h2>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
                <X size={24} />
              </button>
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('tables.tableName')}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
              autoFocus
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowForm(false)} className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600">
                {t('tables.cancel')}
              </button>
              <button onClick={addTable} className="h-12 flex-1 rounded-xl bg-orange-600 font-bold text-white">
                {t('tables.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
