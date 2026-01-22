export interface ContactInfo {
  name: string;
  linkedin?: string;
  website?: string;
  email?: string;
  phone?: string;
}

export interface JobExperience {
  title: string;
  company: string;
  location: string;
  dateRange: string;
  bullets: string[];
}

export interface Education {
  school: string;
  location: string;
  dateRange: string;
  degree: string;
  gpa?: string;
  coursework?: string;
}

export interface SkillCategory {
  label: string;
  skills: string;
}

export interface StartupEntry {
  role: string;
  description: string;
}

export interface ParsedResume {
  contact: ContactInfo;
  experience: JobExperience[];
  startups: StartupEntry[];
  skills: SkillCategory[];
  education: Education[];
  rawSections: Record<string, string>;
}

// Section headers to detect
// Note: These should be standalone section headers, not labels like "Certifications: ..."
const SECTION_PATTERNS = [
  'EXPERIENCE',
  'EDUCATION',
  'SKILLS & COMPETENCIES',
  'SKILLS',
  'UNIVERSITY STARTUPS',
  'STARTUPS',
  'PROJECTS',
  'SUMMARY',
  'OBJECTIVE',
];

function isSectionHeader(line: string): boolean {
  const upperLine = line.toUpperCase().trim();
  
  // A section header should be JUST the section name, possibly followed by a colon
  // but NOT followed by content on the same line (like "Certifications: Aha! PMP...")
  return SECTION_PATTERNS.some(pattern => {
    if (upperLine === pattern) return true;
    
    // If it starts with pattern + colon, check there's no content after
    if (upperLine.startsWith(pattern + ':')) {
      const afterColon = upperLine.substring(pattern.length + 1).trim();
      return afterColon === ''; // Only match if nothing after the colon
    }
    
    return false;
  });
}

function isJobHeader(line: string): boolean {
  // Pattern: Title | Company | Location with optional date
  const pipeCount = (line.match(/\|/g) || []).length;
  return pipeCount >= 2 || (pipeCount >= 1 && /\d{4}/.test(line));
}

export function parseResumeText(text: string): ParsedResume {
  // Normalize line endings and clean up
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.split('\n').map(line => line.trim());
  
  const result: ParsedResume = {
    contact: { name: '' },
    experience: [],
    startups: [],
    skills: [],
    education: [],
    rawSections: {},
  };

  // Extract contact info from the beginning
  let currentIndex = 0;
  
  // First non-empty line is typically the name
  while (currentIndex < lines.length && !lines[currentIndex]) {
    currentIndex++;
  }
  
  if (currentIndex < lines.length) {
    result.contact.name = lines[currentIndex];
    currentIndex++;
  }

  // Parse contact line that might use ● or - or • as separators
  for (let i = currentIndex; i < Math.min(currentIndex + 5, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;
    
    // Check if this line starts a section
    if (isSectionHeader(line)) {
      break;
    }

    // Split by common separators (●, •, |, multiple spaces)
    const parts = line.split(/[●•|]\s*|\s{3,}/).map(p => p.trim()).filter(p => p && p !== '-');
    
    for (const part of parts) {
      // LinkedIn
      if (/linkedin|in\/\w+/i.test(part)) {
        result.contact.linkedin = part.replace(/^[-•●]\s*/, '').trim();
      }
      // Email
      else if (/[\w.-]+@[\w.-]+\.\w+/.test(part)) {
        const match = part.match(/[\w.-]+@[\w.-]+\.\w+/);
        result.contact.email = match ? match[0] : undefined;
      }
      // Phone
      else if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(part)) {
        const match = part.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        result.contact.phone = match ? match[0] : undefined;
      }
      // Website (not linkedin, not email)
      else if (/[\w-]+\.(com|io|dev|me|org|net)/i.test(part) && !/linkedin|@/.test(part)) {
        result.contact.website = part.replace(/^[-•●]\s*/, '').trim();
      }
    }

    // Also check the whole line for patterns if not using separators
    if (!result.contact.email && /[\w.-]+@[\w.-]+\.\w+/.test(line)) {
      const match = line.match(/[\w.-]+@[\w.-]+\.\w+/);
      result.contact.email = match ? match[0] : undefined;
    }
    if (!result.contact.phone && /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line)) {
      const match = line.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      result.contact.phone = match ? match[0] : undefined;
    }
    if (!result.contact.linkedin && /in\/[\w-]+/i.test(line)) {
      const match = line.match(/in\/[\w-]+/i);
      result.contact.linkedin = match ? match[0] : undefined;
    }
    if (!result.contact.website && /[\w-]+\.(com|io|dev|me|org)/i.test(line) && !/linkedin|@/.test(line)) {
      const match = line.match(/[\w-]+\.(com|io|dev|me|org|net)/i);
      if (match && !result.contact.linkedin?.includes(match[0])) {
        result.contact.website = match[0];
      }
    }
  }

  // Find and parse sections
  const sections: { name: string; startIndex: number; endIndex: number }[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase().trim();
    for (const pattern of SECTION_PATTERNS) {
      // Match exact pattern or pattern with colon but NO content after
      if (line === pattern) {
        sections.push({ name: pattern, startIndex: i, endIndex: lines.length });
        break;
      }
      if (line.startsWith(pattern + ':')) {
        const afterColon = line.substring(pattern.length + 1).trim();
        if (afterColon === '') {
          sections.push({ name: pattern, startIndex: i, endIndex: lines.length });
          break;
        }
      }
    }
  }

  // Set end indices
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].endIndex = sections[i + 1].startIndex;
  }

  console.log('[Parser] Detected sections:', sections.map(s => `${s.name} (${s.startIndex}-${s.endIndex})`));

  // Parse each section
  for (const section of sections) {
    const sectionLines = lines.slice(section.startIndex + 1, section.endIndex).filter(l => l);
    const sectionContent = sectionLines.join('\n');
    result.rawSections[section.name] = sectionContent;

    switch (section.name) {
      case 'EXPERIENCE':
        result.experience = parseExperience(sectionLines);
        break;
      case 'EDUCATION':
        result.education = parseEducation(sectionLines);
        break;
      case 'SKILLS & COMPETENCIES':
      case 'SKILLS':
        result.skills = parseSkills(sectionLines);
        break;
      case 'UNIVERSITY STARTUPS':
      case 'STARTUPS':
        result.startups = parseStartups(sectionLines);
        break;
    }
  }

  return result;
}

function parseExperience(lines: string[]): JobExperience[] {
  const experiences: JobExperience[] = [];
  let current: JobExperience | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Date pattern
    const datePattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\s*[-–]\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}))/i;
    const dateMatch = line.match(datePattern);
    
    // Check for job header with pipe separators
    const headerMatch = line.match(/^([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+?)(?:\s{2,}|\t+|$)/);
    
    if (headerMatch) {
      if (current) {
        experiences.push(current);
      }
      
      // Clean up the location (remove date if it's embedded)
      let location = headerMatch[3].trim();
      if (dateMatch) {
        location = location.replace(datePattern, '').trim();
      }
      
      current = {
        title: headerMatch[1].trim(),
        company: headerMatch[2].trim(),
        location: location,
        dateRange: dateMatch ? dateMatch[1].trim() : '',
        bullets: [],
      };
    } else if (current) {
      // This could be a bullet point
      const bulletMatch = line.match(/^[-•*●]\s*(.+)$/);
      
      if (bulletMatch) {
        current.bullets.push(bulletMatch[1].trim());
      } else if (line.length > 20 && !isJobHeader(line) && !isSectionHeader(line)) {
        // It's a longer line without explicit bullet - treat as achievement
        current.bullets.push(line);
      }
    }
  }

  if (current) {
    experiences.push(current);
  }

  return experiences;
}

function parseEducation(lines: string[]): Education[] {
  const education: Education[] = [];
  let current: Education | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Date pattern
    const datePattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\s*[-–]\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}))/i;
    const dateMatch = line.match(datePattern);
    
    // Check for school name with location (e.g., "George Mason University, Fairfax, VA")
    const schoolMatch = line.match(/^([^,]+),\s*([^,]+,\s*[A-Z]{2})/);
    
    if (schoolMatch) {
      if (current) {
        education.push(current);
      }
      
      current = {
        school: schoolMatch[1].trim(),
        location: schoolMatch[2].trim(),
        dateRange: dateMatch ? dateMatch[1].trim() : '',
        degree: '',
      };
    } else if (current) {
      // Check for degree (handle format: "Master of Science: Computer Science" or with CGPA on same line)
      if (/Master|Bachelor|PhD|Doctor|Associate|M\.S\.|B\.S\.|M\.A\.|B\.A\./i.test(line)) {
        // Extract degree, might have CGPA on same line
        let degreeLine = line.replace(/^[-•*]\s*/, '').trim();
        
        // Check if CGPA is on same line and separate it
        const cgpaMatch = degreeLine.match(/\s+(?:CGPA|GPA):\s*([\d.]+)/i);
        if (cgpaMatch) {
          current.gpa = cgpaMatch[1];
          degreeLine = degreeLine.replace(/\s+(?:CGPA|GPA):\s*[\d.]+/i, '').trim();
        }
        
        current.degree = degreeLine;
      }
      // Check for standalone GPA line
      else if (/^(?:CGPA|GPA):\s*([\d.]+)/i.test(line)) {
        const gpaMatch = line.match(/(?:CGPA|GPA):\s*([\d.]+)/i);
        if (gpaMatch) current.gpa = gpaMatch[1];
      }
      // Check for coursework
      else if (/(?:Selected\s+)?Coursework:/i.test(line)) {
        const courseworkMatch = line.match(/(?:Selected\s+)?Coursework:\s*(.+)/i);
        if (courseworkMatch) current.coursework = courseworkMatch[1].trim();
      }
    }
  }

  if (current) {
    education.push(current);
  }

  return education;
}

function parseSkills(lines: string[]): SkillCategory[] {
  const skills: SkillCategory[] = [];

  console.log('[Parser] Parsing skills from', lines.length, 'lines:', lines);

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    
    // Pattern: "Label: skills list" or "- Label: skills list"
    // Find the FIRST colon that separates label from content
    const colonIndex = line.indexOf(':');
    
    if (colonIndex > 0) {
      // Get everything before the first colon as label
      let label = line.substring(0, colonIndex).trim();
      // Remove bullet markers from label
      label = label.replace(/^[-•*●]\s*/, '').trim();
      
      // Get everything after the first colon as content
      const content = line.substring(colonIndex + 1).trim();
      
      // Skip if label is empty or looks like a time/date
      if (label && content && !/^\d{1,2}$/.test(label)) {
        skills.push({
          label: label,
          skills: content,
        });
        console.log('[Parser] Found skill:', label, '->', content.substring(0, 50) + '...');
      }
    }
  }

  console.log('[Parser] Total skills found:', skills.length);
  return skills;
}

function parseStartups(lines: string[]): StartupEntry[] {
  const startups: StartupEntry[] = [];

  for (const line of lines) {
    // Clean the line first - remove bullet markers
    let cleanLine = line.replace(/^[-•*●]\s*/, '').trim();
    
    // Fix common issues like "Co - founder" or "Co- founder" -> "Co-founder"
    cleanLine = cleanLine.replace(/Co\s*[-–]\s*founder/gi, 'Co-founder');
    
    // Pattern: "Role, Company - description"
    // We need to find the FIRST dash that separates role from description
    // But avoid splitting on dashes within the description
    // Look for pattern: "Something, Something - rest of text"
    const match = cleanLine.match(/^([^-–]+?,\s*[^-–]+?)\s*[-–]\s*(.+)$/);
    
    if (match) {
      startups.push({
        role: match[1].trim(),
        description: match[2].trim(),
      });
    } else {
      // Try simpler pattern without comma requirement
      const simpleMatch = cleanLine.match(/^(.+?)\s*[-–]\s*(.+)$/);
      if (simpleMatch) {
        startups.push({
          role: simpleMatch[1].trim(),
          description: simpleMatch[2].trim(),
        });
      } else {
        // No dash separator, treat whole line as description
        startups.push({
          role: '',
          description: cleanLine,
        });
      }
    }
  }

  return startups;
}

// Convert parsed resume back to formatted HTML for editor
export function resumeToHTML(parsed: ParsedResume): string {
  let html = '';

  // Name
  html += `<h1>${parsed.contact.name}</h1>\n`;

  // Contact info
  const contactParts: string[] = [];
  if (parsed.contact.linkedin) contactParts.push(parsed.contact.linkedin);
  if (parsed.contact.website) contactParts.push(parsed.contact.website);
  if (parsed.contact.email) contactParts.push(parsed.contact.email);
  if (parsed.contact.phone) contactParts.push(parsed.contact.phone);
  
  if (contactParts.length > 0) {
    html += `<p>${contactParts.join(' • ')}</p>\n`;
  }

  // Experience
  if (parsed.experience.length > 0) {
    html += `<h2>EXPERIENCE</h2>\n`;
    for (const job of parsed.experience) {
      html += `<h3>${job.title} | ${job.company} | ${job.location}</h3>\n`;
      if (job.dateRange) {
        html += `<p><em>${job.dateRange}</em></p>\n`;
      }
      if (job.bullets.length > 0) {
        html += '<ul>\n';
        for (const bullet of job.bullets) {
          html += `<li>${bullet}</li>\n`;
        }
        html += '</ul>\n';
      }
    }
  }

  // University Startups
  if (parsed.startups.length > 0) {
    html += `<h2>UNIVERSITY STARTUPS</h2>\n`;
    for (const startup of parsed.startups) {
      const text = startup.role ? `${startup.role} - ${startup.description}` : startup.description;
      html += `<p>${text}</p>\n`;
    }
  }

  // Skills
  if (parsed.skills.length > 0) {
    html += `<h2>SKILLS & COMPETENCIES</h2>\n`;
    for (const category of parsed.skills) {
      html += `<p><strong>${category.label}:</strong> ${category.skills}</p>\n`;
    }
  }

  // Education
  if (parsed.education.length > 0) {
    html += `<h2>EDUCATION</h2>\n`;
    for (const edu of parsed.education) {
      html += `<h3>${edu.school}, ${edu.location}</h3>\n`;
      if (edu.dateRange) {
        html += `<p><em>${edu.dateRange}</em></p>\n`;
      }
      if (edu.degree) {
        html += `<p>${edu.degree}</p>\n`;
      }
      if (edu.gpa) {
        html += `<p>CGPA: ${edu.gpa}</p>\n`;
      }
      if (edu.coursework) {
        html += `<p>Selected Coursework: ${edu.coursework}</p>\n`;
      }
    }
  }

  return html;
}
