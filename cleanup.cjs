const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://xafpskaddcdrtfgbphqj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZnBza2FkZGNkcnRmZ2JwaHFqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDM5MTgzMiwiZXhwIjoyMDg1OTY3ODMyfQ.MTSXjuX9jVDvT4buGE2gLsC1NvCb0WHjGaqPvpziBCU'
);

async function cleanup() {
  const orgId = '1dc7be49-0354-4843-95e3-93b7064d19b9';

  const { data: allOrders, error: e1 } = await supabase
    .from('orders')
    .select('id, order_id')
    .eq('organization_id', orgId);

  if (e1 || !allOrders) { console.error('Error fetching orders:', e1); return; }
  console.log('Total orders:', allOrders.length);

  const orderUuids = allOrders.map(o => o.id);
  const { data: itemRows, error: e2 } = await supabase
    .from('order_line_items')
    .select('order_id')
    .in('order_id', orderUuids);

  if (e2) { console.error('Error fetching line items:', e2); return; }

  const withItemsSet = new Set((itemRows || []).map(i => i.order_id));
  const toDelete = allOrders.filter(o => !withItemsSet.has(o.id));

  console.log('Orders to delete:', toDelete.map(o => o.order_id).join(', '));
  console.log('Count:', toDelete.length);

  if (toDelete.length === 0) { console.log('Nothing to delete'); return; }

  const deleteIds = toDelete.map(o => o.id);

  // 1. Unlink synced_emails
  const { data: unlinked, error: ue } = await supabase
    .from('synced_emails').update({ order_id: null }).in('order_id', deleteIds).select('id');
  console.log('Unlinked emails:', (unlinked || []).length, ue ? ue.message : 'OK');

  // 2. Delete order_history
  const { data: dh, error: he } = await supabase
    .from('order_history').delete().in('order_id', deleteIds).select('id');
  console.log('Deleted history:', (dh || []).length, he ? he.message : 'OK');

  // 3. Delete orders
  const { data: dord, error: oe } = await supabase
    .from('orders').delete().in('id', deleteIds).select('id, order_id');
  console.log('Deleted orders:', (dord || []).map(o => o.order_id).join(', '), oe ? oe.message : 'OK');

  // Verify
  const { count } = await supabase
    .from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
  console.log('Remaining orders:', count);
}

cleanup().catch(e => console.error(e));
