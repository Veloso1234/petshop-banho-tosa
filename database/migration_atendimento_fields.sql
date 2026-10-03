-- Execute no SQL Editor do Supabase para atualizar uma tabela existente.
-- Os campos já preenchidos não são alterados; registros antigos assumem Tutor entrega.
ALTER TABLE public.fichas
  ADD COLUMN IF NOT EXISTS telefone_tutor TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS valor NUMERIC(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS forma_entrega TEXT NOT NULL DEFAULT 'tutor',
  ADD COLUMN IF NOT EXISTS endereco_busca TEXT DEFAULT '';

UPDATE public.fichas
SET forma_entrega = 'tutor'
WHERE forma_entrega IS NULL OR forma_entrega = '';
