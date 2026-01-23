import jsPDF from 'jspdf';

/**
 * Load font file and convert to base64 for jsPDF embedding
 */
async function loadFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generates a TEXT-based PDF that matches the preview exactly.
 * 
 * Approach: Measure actual element positions from the DOM and render
 * text at those exact coordinates in the PDF. This gives us:
 * 1. Real, selectable, ATS-parseable text
 * 2. Layout that matches the preview exactly
 * 3. No images, no invisible text - just a legitimate text PDF
 * 
 * Uses Carlito font (metrically identical to Calibri) for perfect
 * preview-to-PDF matching.
 */
export async function generatePDF(elementId: string = 'resume-preview', filename: string = 'resume.pdf'): Promise<void> {
  const resumeElement = document.getElementById(elementId);
  if (!resumeElement) {
    throw new Error('Resume preview element not found');
  }

  // Create PDF - Letter size (8.5 x 11 inches = 612 x 792 points)
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true,
  });

  // Load and embed Carlito fonts (metrically identical to Calibri)
  try {
    const [regularFont, boldFont, italicFont, boldItalicFont] = await Promise.all([
      loadFontAsBase64('/fonts/Carlito-Regular.ttf'),
      loadFontAsBase64('/fonts/Carlito-Bold.ttf'),
      loadFontAsBase64('/fonts/Carlito-Italic.ttf'),
      loadFontAsBase64('/fonts/Carlito-BoldItalic.ttf'),
    ]);

    // Register Carlito Regular
    pdf.addFileToVFS('Carlito-Regular.ttf', regularFont);
    pdf.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');

    // Register Carlito Bold
    pdf.addFileToVFS('Carlito-Bold.ttf', boldFont);
    pdf.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');

    // Register Carlito Italic
    pdf.addFileToVFS('Carlito-Italic.ttf', italicFont);
    pdf.addFont('Carlito-Italic.ttf', 'Carlito', 'italic');

    // Register Carlito Bold Italic
    pdf.addFileToVFS('Carlito-BoldItalic.ttf', boldItalicFont);
    pdf.addFont('Carlito-BoldItalic.ttf', 'Carlito', 'bolditalic');

    console.log('Carlito fonts loaded successfully');
  } catch (error) {
    console.warn('Failed to load Carlito fonts, falling back to Helvetica:', error);
  }

  // Use Carlito as the default font (falls back to Helvetica if not loaded)
  const FONT_FAMILY = pdf.getFontList()['Carlito'] ? 'Carlito' : 'helvetica';

  // Get resume element dimensions for coordinate conversion
  const resumeRect = resumeElement.getBoundingClientRect();
  
  // PDF dimensions in points
  const PDF_WIDTH = 612;
  const PDF_HEIGHT = 792;
  
  // Scale factors to convert from screen pixels to PDF points
  const scaleX = PDF_WIDTH / resumeRect.width;
  const scaleY = PDF_HEIGHT / resumeRect.height;

  /**
   * Convert screen coordinates to PDF coordinates
   */
  const toPdfX = (screenX: number): number => {
    return (screenX - resumeRect.left) * scaleX;
  };
  
  const toPdfY = (screenY: number): number => {
    return (screenY - resumeRect.top) * scaleY;
  };

  /**
   * ULTIMATE SOLUTION: Get EXACT line breaks from the ACTUAL rendered element
   * Uses Range API to measure where each character is positioned in the real DOM
   * This gives us the EXACT same lines as visible in the preview
   */
  const getExactLinesFromDOM = (element: HTMLElement): string[] => {
    const text = element.textContent || '';
    if (!text.trim()) return [];
    
    // Find all text nodes in the element
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    
    if (textNodes.length === 0) return [text.trim()];
    
    // Build a map of character positions
    const range = document.createRange();
    const charPositions: { char: string; y: number }[] = [];
    
    textNodes.forEach(textNode => {
      const nodeText = textNode.textContent || '';
      for (let i = 0; i < nodeText.length; i++) {
        try {
          range.setStart(textNode, i);
          range.setEnd(textNode, i + 1);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            charPositions.push({
              char: nodeText[i],
              y: Math.round(rects[0].top) // Round to avoid floating point issues
            });
          }
        } catch (e) {
          // Skip characters that can't be measured
          charPositions.push({ char: nodeText[i], y: charPositions.length > 0 ? charPositions[charPositions.length - 1].y : 0 });
        }
      }
    });
    
    if (charPositions.length === 0) return [text.trim()];
    
    // Group characters by Y position to form lines
    const lines: string[] = [];
    let currentLine = '';
    let currentY = charPositions[0].y;
    
    charPositions.forEach(({ char, y }) => {
      // If Y changed significantly (more than 3px), it's a new line
      if (Math.abs(y - currentY) > 3) {
        const trimmedLine = currentLine.trim();
        if (trimmedLine) {
          lines.push(trimmedLine);
        }
        currentLine = '';
        currentY = y;
      }
      currentLine += char;
    });
    
    // Don't forget the last line
    const lastLine = currentLine.trim();
    if (lastLine) {
      lines.push(lastLine);
    }
    
    return lines;
  };

  /**
   * Check if a word (without punctuation) is a metric that should be bold
   * Matches: 40%, $5M, 60+, 400k, 2x, 100+, $5M+, etc.
   */
  const isMetricWord = (word: string): boolean => {
    // Strip leading/trailing punctuation for checking
    const cleanWord = word.replace(/^[^$\d]+|[^%KMBkmbxX+\d]+$/g, '');
    if (!cleanWord) return false;
    
    // Pattern: optional $, digits (with optional commas), optional decimal, optional suffix
    const metricPattern = /^\$?\d+(?:,\d{3})*(?:\.\d+)?[%KMBkmbxX+]*\+?$/;
    return metricPattern.test(cleanWord) && /\d/.test(cleanWord) && 
           // Must have a meaningful suffix or be a dollar amount to be considered a metric
           (/[%KMBkmbxX+]/.test(cleanWord) || /^\$/.test(cleanWord));
  };

  /**
   * Render a single line with bold metrics, ensuring it NEVER exceeds maxWidth
   * Compresses horizontally if needed by reducing character spacing
   */
  const renderLineWithBoldMetrics = (line: string, startX: number, y: number, fontSize: number, maxWidth?: number) => {
    // Split into words, preserving the original structure
    const words = line.split(' ').filter(w => w); // Remove empty strings
    
    pdf.setFontSize(fontSize);
    pdf.setTextColor(0, 0, 0);
    
    // Calculate space width using normal font (consistent spacing)
    pdf.setFont(FONT_FAMILY, 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    // If maxWidth is specified, check if we need to compress
    if (maxWidth) {
      // Calculate actual width with bold metrics
      let totalWidth = 0;
      words.forEach((word, index) => {
        const shouldBold = isMetricWord(word);
        pdf.setFont(FONT_FAMILY, shouldBold ? 'bold' : 'normal');
        totalWidth += pdf.getTextWidth(word);
        if (index < words.length - 1) {
          totalWidth += spaceWidth;
        }
      });
      
      // If text would overflow, use character spacing to compress it
      if (totalWidth > maxWidth) {
        const compressionRatio = maxWidth / totalWidth;
        
        // Render entire line as one unit with character spacing
        let currentX = startX;
        words.forEach((word, index) => {
          const shouldBold = isMetricWord(word);
          pdf.setFont(FONT_FAMILY, shouldBold ? 'bold' : 'normal');
          
          const naturalWidth = pdf.getTextWidth(word);
          const compressedWidth = naturalWidth * compressionRatio;
          
          // Calculate character spacing needed for compression
          const charSpacing = (compressedWidth - naturalWidth) / (word.length || 1);
          pdf.setCharSpace(charSpacing);
          
          pdf.text(word, currentX, y);
          currentX += compressedWidth;
          
          // Add space (also compressed)
          if (index < words.length - 1) {
            pdf.setCharSpace(0); // Reset for space
            currentX += spaceWidth * compressionRatio;
          }
        });
        
        pdf.setCharSpace(0); // Reset character spacing
        return;
      }
    }
    
    // Normal rendering (no compression needed)
    let currentX = startX;
    
    words.forEach((word, index) => {
      // Check if this word contains a metric
      const shouldBold = isMetricWord(word);
      
      // Set appropriate font
      pdf.setFont(FONT_FAMILY, shouldBold ? 'bold' : 'normal');
      
      // Render the word
      pdf.text(word, currentX, y);
      
      // Move position by word width (measured with current font)
      currentX += pdf.getTextWidth(word);
      
      // Add space after word (except for last word)
      if (index < words.length - 1) {
        currentX += spaceWidth;
      }
    });
  };

  /**
   * Calculate line width with mixed fonts (for proper line wrapping)
   */
  const getLineWidthWithMetrics = (line: string, fontSize: number): number => {
    const words = line.split(' ');
    pdf.setFontSize(fontSize);
    pdf.setFont(FONT_FAMILY, 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    let width = 0;
    words.forEach((word, index) => {
      if (!word) {
        width += spaceWidth;
        return;
      }
      
      const shouldBold = isMetricWord(word);
      pdf.setFont(FONT_FAMILY, shouldBold ? 'bold' : 'normal');
      width += pdf.getTextWidth(word);
      
      if (index < words.length - 1) {
        width += spaceWidth;
      }
    });
    
    return width;
  };

  /**
   * Split text into lines considering mixed bold/normal fonts
   */
  const splitTextWithMetrics = (text: string, maxWidth: number, fontSize: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    pdf.setFontSize(fontSize);
    pdf.setFont(FONT_FAMILY, 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    words.forEach(word => {
      if (!word) return;
      
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testWidth = getLineWidthWithMetrics(testLine, fontSize);
      
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  };

  /**
   * Get font style from computed style
   */
  const getFontStyle = (computedStyle: CSSStyleDeclaration): 'normal' | 'bold' | 'italic' | 'bolditalic' => {
    const weight = computedStyle.fontWeight;
    const style = computedStyle.fontStyle;
    const isBold = weight === 'bold' || parseInt(weight) >= 600;
    const isItalic = style === 'italic';
    
    if (isBold && isItalic) return 'bolditalic';
    if (isBold) return 'bold';
    if (isItalic) return 'italic';
    return 'normal';
  };

  /**
   * Convert pixel font size to points
   */
  const pxToPt = (px: number): number => {
    return px * 72 / 96; // 96 DPI standard
  };

  /**
   * Parse RGB color string to array
   */
  const parseColor = (colorStr: string): [number, number, number] => {
    const match = colorStr.match(/\d+/g);
    if (match && match.length >= 3) {
      return [parseInt(match[0]), parseInt(match[1]), parseInt(match[2])];
    }
    return [0, 0, 0]; // Default black
  };

  /**
   * Render a text element to PDF at its exact position
   */
  const renderTextElement = (element: Element, text?: string) => {
    const el = element as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    const content = text || el.textContent?.trim() || '';
    if (!content) return;
    
    // Get position in PDF coordinates
    const x = toPdfX(rect.left);
    const y = toPdfY(rect.top);
    
    // Get font properties
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const fontStyle = getFontStyle(style);
    const color = parseColor(style.color);
    
    // Set PDF font properties
    pdf.setFont(FONT_FAMILY, fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);
    
    // Calculate max width for text wrapping
    const maxWidth = rect.width * scaleX;
    
    // For single-line elements, render directly
    // For multi-line, use splitTextToSize
    if (el.offsetHeight <= parseFloat(style.lineHeight) * 1.5) {
      // Single line - render at baseline position
      const baseline = y + fontSize * 0.85; // Approximate baseline
      pdf.text(content, x, baseline);
    } else {
      // Multi-line - wrap text
      const lines = pdf.splitTextToSize(content, maxWidth);
      const lineHeight = fontSize * 1.35;
      const baseline = y + fontSize * 0.85;
      
      lines.forEach((line: string, index: number) => {
        pdf.text(line, x, baseline + (index * lineHeight));
      });
    }
  };

  /**
   * Render text with specific positioning (for flex layouts)
   */
  const renderTextAt = (
    text: string, 
    rect: DOMRect, 
    style: CSSStyleDeclaration,
    align: 'left' | 'right' | 'center' = 'left'
  ) => {
    if (!text.trim()) return;
    
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const fontStyle = getFontStyle(style);
    const color = parseColor(style.color);
    
    pdf.setFont(FONT_FAMILY, fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);
    
    const y = toPdfY(rect.top) + fontSize * 0.85;
    let x = toPdfX(rect.left);
    
    if (align === 'right') {
      const textWidth = pdf.getTextWidth(text);
      x = toPdfX(rect.right) - textWidth;
    } else if (align === 'center') {
      const textWidth = pdf.getTextWidth(text);
      x = toPdfX(rect.left + rect.width / 2) - textWidth / 2;
    }
    
    pdf.text(text, x, y);
  };

  /**
   * Draw a horizontal line below section title
   */
  const drawSectionUnderline = (element: Element, textY: number, fontSize: number) => {
    const el = element as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    const borderWidth = parseFloat(style.borderBottomWidth) || 1;
    const borderColor = parseColor(style.borderBottomColor);
    
    // Draw line just below the text (5pt gap from baseline to match preview)
    const lineY = textY + 5;
    
    pdf.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    pdf.setLineWidth(borderWidth * scaleY);
    pdf.line(toPdfX(rect.left), lineY, toPdfX(rect.right), lineY);
  };

  // ========== RENDER RESUME CONTENT ==========

  // 1. NAME (centered)
  const nameEl = resumeElement.querySelector('.resume-name');
  if (nameEl) {
    const rect = nameEl.getBoundingClientRect();
    const style = window.getComputedStyle(nameEl);
    const text = nameEl.textContent?.trim() || '';
    
    const fontSize = pxToPt(parseFloat(style.fontSize));
    pdf.setFont(FONT_FAMILY, 'bold');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(0, 0, 0);
    
    const textWidth = pdf.getTextWidth(text);
    const x = (PDF_WIDTH - textWidth) / 2;
    const y = toPdfY(rect.top) + fontSize * 0.85;
    
    pdf.text(text, x, y);
  }

  // 2. CONTACT LINE (centered with bullet points)
  const contactLine = resumeElement.querySelector('.contact-line');
  if (contactLine) {
    const rect = contactLine.getBoundingClientRect();
    const style = window.getComputedStyle(contactLine);
    
    // Get all contact items - just the text values, no symbols
    const items: { text: string; url?: string }[] = [];
    
    contactLine.querySelectorAll('.contact-item').forEach(item => {
      const text = item.querySelector('span:not(.contact-icon)')?.textContent?.trim() || '';
      const link = item.closest('a') as HTMLAnchorElement;
      
      if (text) {
        items.push({
          text: text,
          url: link?.href
        });
      }
    });
    
    // Build contact string with bullet separators (leading bullet only, no trailing)
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const bulletFontSize = fontSize; // Same size as text
    
    // Calculate total width for centering
    pdf.setFont(FONT_FAMILY, 'normal');
    pdf.setFontSize(bulletFontSize);
    const bulletChar = '•';
    const bulletWidth = pdf.getTextWidth(bulletChar);
    pdf.setFontSize(fontSize);
    // Asymmetric spacing: more space BEFORE bullet (after prev item), less AFTER bullet (before next item)
    // This groups each bullet with its following item, creating clear visual sections
    const spaceBeforeBullet = pdf.getTextWidth('      '); // 6 spaces - larger gap after item
    const spaceAfterBullet = pdf.getTextWidth('  ');      // 2 spaces - bullet close to its item
    
    let totalWidth = bulletWidth + spaceAfterBullet; // Leading bullet + small space
    items.forEach((item, i) => {
      totalWidth += pdf.getTextWidth(item.text);
      if (i < items.length - 1) {
        totalWidth += spaceBeforeBullet + bulletWidth + spaceAfterBullet; // large space + bullet + small space
      }
    });
    
    // Render centered
    const startX = (PDF_WIDTH - totalWidth) / 2;
    const textY = toPdfY(rect.top) + fontSize * 0.85;
    // Bullet same size as text, same baseline
    const bulletY = textY;
    let currentX = startX;
    
    pdf.setTextColor(0, 0, 0);
    
    // Render leading bullet (same size as text)
    pdf.setFontSize(bulletFontSize);
    pdf.text(bulletChar, currentX, bulletY);
    currentX += bulletWidth + spaceAfterBullet; // Small space after leading bullet
    
    // Render items with bullet separators
    items.forEach((item, i) => {
      // Render item text
      pdf.setFontSize(fontSize);
      pdf.text(item.text, currentX, textY);
      
      // Add hyperlink if exists
      if (item.url) {
        const itemWidth = pdf.getTextWidth(item.text);
        pdf.link(currentX, textY - fontSize, itemWidth, fontSize * 1.2, { url: item.url });
      }
      
      currentX += pdf.getTextWidth(item.text);
      
      // Add bullet separator (except after last item)
      if (i < items.length - 1) {
        currentX += spaceBeforeBullet; // Large space after item
        pdf.setFontSize(bulletFontSize);
        pdf.text(bulletChar, currentX, bulletY);
        currentX += bulletWidth + spaceAfterBullet; // Small space before next item
      }
    });
  }

  // 3. SECTIONS - Use DOM positions directly (no manual Y tracking)
  // The DOM has already laid out everything correctly - trust it completely
  resumeElement.querySelectorAll('.resume-section').forEach(section => {
    // Section Title with underline
    const titleEl = section.querySelector('.section-title');
    if (titleEl) {
      const rect = titleEl.getBoundingClientRect();
      const style = window.getComputedStyle(titleEl);
      const text = titleEl.textContent?.trim() || '';
      
      const fontSize = pxToPt(parseFloat(style.fontSize));
      pdf.setFont(FONT_FAMILY, 'bold');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(0, 0, 0);
      
      const x = toPdfX(rect.left);
      const y = toPdfY(rect.top) + fontSize * 0.85;
      
      pdf.text(text, x, y);
      drawSectionUnderline(titleEl, y, fontSize);
    }

    // JOB ENTRIES - Use DOM positions exactly
    section.querySelectorAll('.job-entry').forEach(job => {
      // Job title
      const titleLineEl = job.querySelector('.job-title-line');
      if (titleLineEl) {
        const rect = titleLineEl.getBoundingClientRect();
        const style = window.getComputedStyle(titleLineEl);
        const text = titleLineEl.textContent?.trim() || '';
        const fontSize = pxToPt(parseFloat(style.fontSize));
        
        pdf.setFont(FONT_FAMILY, 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(text, toPdfX(rect.left), toPdfY(rect.top) + fontSize * 0.85);
      }
      
      // Job date (right-aligned)
      const dateEl = job.querySelector('.job-date');
      if (dateEl) {
        const rect = dateEl.getBoundingClientRect();
        const style = window.getComputedStyle(dateEl);
        const text = dateEl.textContent?.trim() || '';
        const fontSize = pxToPt(parseFloat(style.fontSize));
        
        pdf.setFont(FONT_FAMILY, 'italic');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(51, 51, 51);
        const textWidth = pdf.getTextWidth(text);
        pdf.text(text, toPdfX(rect.right) - textWidth, toPdfY(rect.top) + fontSize * 0.85);
      }
      
      // Bullets - USE BROWSER'S EXACT LINE BREAKS for perfect preview match
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        const bulletEl = bullet as HTMLElement;
        const rect = bulletEl.getBoundingClientRect();
        const style = window.getComputedStyle(bulletEl);
        const text = bulletEl.textContent?.trim() || '';
        if (!text) return;
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        // Get line height from CSS
        const lineHeightPx = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.45);
        const lineHeight = pxToPt(lineHeightPx);
        
        // Render bullet point (same size as text)
        const bulletFontSize = fontSize; // Same size as text
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setFontSize(bulletFontSize);
        pdf.setTextColor(0, 0, 0);
        const bulletChar = '•';
        const bulletY = y; // Same baseline as text
        pdf.text(bulletChar, x, bulletY);
        
        const bulletWidth = pdf.getTextWidth(bulletChar + '   '); // 3 spaces for more gap
        const textStartX = x + bulletWidth;
        const textMaxWidth = (rect.width * scaleX) - bulletWidth;
        
        // ULTIMATE: Get the EXACT line breaks from the ACTUAL rendered element
        // Uses Range API to measure real character positions - gives EXACT replica
        const exactLines = getExactLinesFromDOM(bulletEl);
        
        // Render each line EXACTLY as it appears in the preview
        exactLines.forEach((line: string, i: number) => {
          const lineY = y + (i * lineHeight);
          const lineX = i === 0 ? textStartX : x + bulletWidth;
          
          // Render with bold metrics, compress horizontally if needed to fit
          renderLineWithBoldMetrics(line, lineX, lineY, fontSize, textMaxWidth);
        });
      });
    });

    // STARTUP ENTRIES - Single line with role and description, compress if needed
    section.querySelectorAll('.startup-entry').forEach(startup => {
      const rect = startup.getBoundingClientRect();
      const style = window.getComputedStyle(startup);
      const fontSize = pxToPt(parseFloat(style.fontSize));
      const y = toPdfY(rect.top) + fontSize * 0.85;
      let x = toPdfX(rect.left);
      
      const roleEl = startup.querySelector('.startup-role');
      const descEl = startup.querySelector('.startup-desc');
      
      if (roleEl) {
        const role = roleEl.textContent?.trim() || '';
        pdf.setFont(FONT_FAMILY, 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(role, x, y);
        x += pdf.getTextWidth(role);
      }
      
      if (descEl) {
        const desc = descEl.textContent?.trim() || '';
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setFontSize(fontSize);
        pdf.text(' - ', x, y);
        x += pdf.getTextWidth(' - ');
        
        // Calculate available width and render with compression if needed
        const descMaxWidth = (rect.width * scaleX) - (x - toPdfX(rect.left));
        renderLineWithBoldMetrics(desc, x, y, fontSize, descMaxWidth);
      }
    });

    // SKILL LINES - Match DOM's line count, keep natural spacing
    section.querySelectorAll('.skill-line').forEach(skill => {
      const rect = skill.getBoundingClientRect();
      const style = window.getComputedStyle(skill);
      
      const labelEl = skill.querySelector('.skill-label');
      const contentEl = skill.querySelector('.skill-content');
      
      const baseFontSize = pxToPt(parseFloat(style.fontSize));
      const y = toPdfY(rect.top) + baseFontSize * 0.85;
      let x = toPdfX(rect.left);
      
      // Calculate expected line count from DOM
      const lineHeightPx = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.35);
      const expectedLineCount = Math.max(1, Math.round(rect.height / lineHeightPx));
      const lineHeight = pxToPt(lineHeightPx);
      
      if (labelEl) {
        const label = labelEl.textContent?.trim() || '';
        pdf.setFont(FONT_FAMILY, 'bold');
        pdf.setFontSize(baseFontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(label + ': ', x, y);
        x += pdf.getTextWidth(label + ': ');
      }
      
      if (contentEl) {
        const content = contentEl.textContent?.trim() || '';
        pdf.setFont(FONT_FAMILY, 'normal');
        
        const maxWidth = toPdfX(rect.right) - x;
        
        // Find font size that matches DOM's line count
        let currentFontSize = baseFontSize;
        pdf.setFontSize(currentFontSize);
        let lines = pdf.splitTextToSize(content, maxWidth);
        
        while (lines.length > expectedLineCount && currentFontSize > baseFontSize * 0.85) {
          currentFontSize -= 0.3;
          pdf.setFontSize(currentFontSize);
          lines = pdf.splitTextToSize(content, maxWidth);
        }
        
        // Render with natural line spacing
        lines.forEach((line: string, index: number) => {
          const lineY = y + (index * lineHeight);
          if (index === 0) {
            pdf.text(line, x, lineY);
          } else {
            pdf.text(line, toPdfX(rect.left), lineY);
          }
        });
      }
    });

    // EDUCATION
    const eduEntry = section.querySelector('.education-entry');
    if (eduEntry) {
      // School line
      const schoolEl = section.querySelector('.education-school');
      const eduDateEl = section.querySelector('.education-date');
      
      if (schoolEl) {
        const rect = schoolEl.getBoundingClientRect();
        const style = window.getComputedStyle(schoolEl);
        const text = schoolEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont(FONT_FAMILY, 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      if (eduDateEl) {
        const rect = eduDateEl.getBoundingClientRect();
        const style = window.getComputedStyle(eduDateEl);
        const text = eduDateEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont(FONT_FAMILY, 'italic');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(51, 51, 51);
        
        const textWidth = pdf.getTextWidth(text);
        const x = toPdfX(rect.right) - textWidth;
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      // Degree and GPA row
      const degreeEl = section.querySelector('.education-degree');
      const gpaEl = section.querySelector('.education-gpa');
      
      if (degreeEl) {
        const rect = degreeEl.getBoundingClientRect();
        const style = window.getComputedStyle(degreeEl);
        const text = degreeEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      if (gpaEl) {
        const rect = gpaEl.getBoundingClientRect();
        const style = window.getComputedStyle(gpaEl);
        const text = gpaEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const textWidth = pdf.getTextWidth(text);
        const x = toPdfX(rect.right) - textWidth;
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      // Coursework detail - Match DOM's line count, keep natural spacing
      const detailEl = section.querySelector('.education-detail');
      if (detailEl) {
        const rect = detailEl.getBoundingClientRect();
        const style = window.getComputedStyle(detailEl);
        const text = detailEl.textContent?.trim() || '';
        
        const baseFontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + baseFontSize * 0.85;
        const maxWidth = rect.width * scaleX;
        
        // Calculate expected line count from DOM
        const lineHeightPx = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.35);
        const expectedLineCount = Math.max(1, Math.round(rect.height / lineHeightPx));
        const lineHeight = pxToPt(lineHeightPx);
        
        // Find font size that matches DOM's line count
        let currentFontSize = baseFontSize;
        pdf.setFontSize(currentFontSize);
        let lines = pdf.splitTextToSize(text, maxWidth);
        
        while (lines.length > expectedLineCount && currentFontSize > baseFontSize * 0.85) {
          currentFontSize -= 0.3;
          pdf.setFontSize(currentFontSize);
          lines = pdf.splitTextToSize(text, maxWidth);
        }
        
        // Render with natural line spacing
        lines.forEach((line: string, index: number) => {
          pdf.text(line, x, y + (index * lineHeight));
        });
      }
    }
  });

  // Save the PDF
  pdf.save(filename);
  console.log('[PDF] Generated text-based PDF with DOM-measured positions!');
}
