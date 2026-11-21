-- ============================================================
-- Jobs4U Supabase Setup
-- Run this SQL in your Supabase Dashboard > SQL Editor
-- ============================================================

-- 0. Confirm admin email (so login works immediately)
UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'hr.konsultancy@gmail.com';

-- 1. Create the sections table
CREATE TABLE IF NOT EXISTS public.sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active sections"
  ON public.sections FOR SELECT USING (active = true);

CREATE POLICY "Authenticated users can view all sections"
  ON public.sections FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert sections"
  ON public.sections FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update sections"
  ON public.sections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete sections"
  ON public.sections FOR DELETE TO authenticated USING (true);

-- 2. Create the posters table (no CHECK constraint on section — any slug allowed)
CREATE TABLE IF NOT EXISTS public.posters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  image_url TEXT NOT NULL,
  recruitment_info TEXT DEFAULT '',
  whatsapp_text TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable Row Level Security
ALTER TABLE public.posters ENABLE ROW LEVEL SECURITY;

-- 4. Allow public read access (anyone can view active posters)
CREATE POLICY "Public can view active posters"
  ON public.posters
  FOR SELECT
  USING (active = true);

-- 5. Allow authenticated users to manage posters (full CRUD)
CREATE POLICY "Authenticated users can view all posters"
  ON public.posters
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert posters"
  ON public.posters
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update posters"
  ON public.posters
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete posters"
  ON public.posters
  FOR DELETE
  TO authenticated
  USING (true);

-- 6. Create storage bucket for poster images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'posters',
  'posters',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage policies — public read, authenticated upload
CREATE POLICY "Public can view poster images"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'posters');

CREATE POLICY "Authenticated users can upload poster images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'posters');

CREATE POLICY "Authenticated users can update poster images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'posters');

CREATE POLICY "Authenticated users can delete poster images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'posters');

-- 8. Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posters_updated_at
  BEFORE UPDATE ON public.posters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 9. Insert default sections
INSERT INTO public.sections (name, slug, sort_order) VALUES
  ('Kee Hing Hung', 'khh', 1),
  ('HR Konsultancy', 'hr-konsultancy', 2),
  ('iTpartners.sg', 'itpartners', 3),
  ('SingaporeAccounting.co', 'sg-accounting', 4),
  ('Merlion Technologies', 'merlion', 5);

-- 10. Insert default poster data
INSERT INTO public.posters (section, title, description, tags, image_url, whatsapp_text, sort_order) VALUES
  -- Merlion Technologies
  ('merlion', 'AI / Machine Learning Engineer', 'Develop, deploy, and optimize ML models including fine-tuning LLMs for production use.', ARRAY['Python', 'MLOps', 'Docker'], 'ml-engineer.jpeg', 'Hi, I am interested in the ML Engineer position', 1),
  ('merlion', 'Data Engineer (ETL / Pipeline)', 'Design and optimize scalable data pipelines for warehousing, analytics, and system performance.', ARRAY['SQL', 'Spark', 'Airflow'], 'data-engineer.jpeg', 'Hi, I am interested in the Data Engineer position', 2),
  ('merlion', 'IT Project Manager (Agile / Scrum)', 'Lead end-to-end IT projects ensuring delivery within scope, timeline, and budget.', ARRAY['Agile', 'Scrum', 'SDLC'], 'it-pm.jpeg', 'Hi, I am interested in the IT Project Manager position', 3),
  ('merlion', 'Product Owner / Business Analyst', 'Bridge business and technical teams by translating requirements into structured deliverables.', ARRAY['Jira', 'UML', 'SQL'], 'ba.jpeg', 'Hi, I am interested in the Business Analyst position', 4),

  -- Kee Hing Hung
  ('khh', 'Luxury Watch Sales', '', '{}', 'green-hiring.jpg', 'Hi, I am interested in the Luxury Watch Sales position', 1),
  ('khh', 'Luxury Watch Retail', '', '{}', 'rose-golden-hiring.jpg', 'Hi, I am interested in the Luxury Watch Retail position', 2),
  ('khh', 'Luxury Watch Position', '', '{}', 'blue-hiring.jpg', 'Hi, I am interested in the Luxury Watch position', 3),
  ('khh', 'Luxury Watch Sales Executive', 'In-store sales at Tudor. SGD 4,000 basic + up to SGD 5,000 commission.', ARRAY['Sales', 'Tudor', 'Retail'], 'khh-watch-sales-tudor.webp', 'Hi, I am interested in the KHH Luxury Watch Sales Executive position', 4),

  -- iTpartners.sg
  ('itpartners', 'React.js Developer', 'Build modern, high-performance web applications with exceptional user experiences.', ARRAY['React', 'JavaScript', 'HTML5', 'CSS3'], 'itp-reactjs-developer.jpg', 'Hi, I am interested in the React.js Developer position', 1),
  ('itpartners', 'MuleSoft Developer', 'Design, build and deliver reliable integrations and APIs that connect systems.', ARRAY['MuleSoft', 'APIs', 'Integration'], 'itp-mulesoft-developer.jpg', 'Hi, I am interested in the MuleSoft Developer position', 2),
  ('itpartners', 'IT Manager Positions (WFH)', 'Multiple IT management roles available. Work from home. Singaporean & PR only.', ARRAY['WFH', 'IT Management', 'Singapore'], 'itp-it-manager-wfh.jpg', 'Hi, I am interested in the IT Manager positions at iTpartners', 3),
  ('itpartners', 'IT Engineer Positions (WFH)', 'Multiple IT engineering roles available. Work from home. MY/SG/ID nationals.', ARRAY['WFH', 'IT Engineering', 'Infrastructure'], 'itp-it-engineer-wfh.jpg', 'Hi, I am interested in the IT Engineer positions at iTpartners', 4),
  ('itpartners', 'Open Developer Positions', 'Full Stack, Java, .NET, Flutter, MuleSoft, React JS Developer & IT Assistant roles.', ARRAY['WFH', 'Full Stack', 'Java', '.NET', 'Flutter'], 'itp-open-dev-positions.webp', 'Hi, I am interested in the Developer positions at iTpartners', 5),

  -- HR Konsultancy
  ('hr-konsultancy', 'Luxury Watch Sales Executive', 'SGD 4,500++ basic salary. Competitive pay and performance bonus.', ARRAY['Sales', 'Retail', 'Luxury'], 'hr-watch-sales-exec.jpg', 'Hi, I am interested in the Luxury Watch Sales Executive position', 1),
  ('hr-konsultancy', 'Content Creator (AI)', 'Create engaging AI content. Work from home with flexible hours.', ARRAY['AI', 'Content', 'WFH', 'Writing'], 'hr-content-creator.jpg', 'Hi, I am interested in the Content Creator position', 2),
  ('hr-konsultancy', 'WFH Sales Executives', 'High commission sales role. Work from home. Indonesian or Malaysian talents.', ARRAY['Sales', 'WFH', 'Commission'], 'hr-sales-exec-wfh.jpg', 'Hi, I am interested in the WFH Sales Executive position', 3),
  ('hr-konsultancy', 'Freelance Presentation Designer', 'Work from home. Pay within 12 hours. Max 20 slides, AI tools allowed.', ARRAY['Design', 'Freelance', 'WFH', 'AI'], 'hr-presentation-designer.jpg', 'Hi, I am interested in the Freelance Presentation Designer position', 4),

  -- SingaporeAccounting.co
  ('sg-accounting', 'Accountant (ACCA)', 'Prepare financial statements, manage budgeting, ensure compliance. Must be ACCA qualified. Work from home.', ARRAY['ACCA', 'Accounting', 'WFH', 'Finance'], 'sga-accountant.jpg', 'Hi, I am interested in the Accountant position', 1);
