# Resume Formatter

A modern web application to transform plain-text resumes into professionally formatted documents with PDF export.

## Features

- **Auto-Format**: Paste plain text and automatically detect sections (Experience, Education, Skills, etc.)
- **Rich Text Editor**: Edit your resume with a Google Docs-like experience using TipTap
- **Live Preview**: See your formatted resume in real-time
- **PDF Export**: Download your resume as a perfectly formatted PDF

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
cd resume-formatter
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Usage

1. **Paste**: Copy your GPT-generated resume text and paste it into the input area
2. **Format**: Click "Format Resume" to auto-detect sections and structure
3. **Edit**: Use the rich text editor to make any adjustments
4. **Preview**: View the live preview of your formatted resume
5. **Download**: Click "Download PDF" to get your final document

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Rich Text Editor**: TipTap
- **PDF Generation**: html2canvas + jsPDF
- **Icons**: Lucide React

## Resume Format Detection

The parser automatically detects these sections:
- EXPERIENCE
- EDUCATION
- SKILLS & COMPETENCIES / SKILLS
- UNIVERSITY STARTUPS / STARTUPS
- PROJECTS
- CERTIFICATIONS
- SUMMARY
- OBJECTIVE

## License

MIT
