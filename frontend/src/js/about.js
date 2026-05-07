/**
 * about.js — renders the About section from /api/settings.
 */

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const $ = (sel) => document.querySelector(sel)

const section = $('[data-testid="about-section"]')
const eyebrow = $('[data-testid="about-eyebrow"]')
const titlePre = $('[data-testid="about-title-pre"]')
const titleEm = $('[data-testid="about-title-emphasis"]')
const photoFrame = $('[data-testid="about-photo-frame"]')
const photoImg = $('[data-testid="about-photo-img"]')
const photoFallback = $('[data-testid="about-photo-fallback"]')
const personName = $('[data-testid="about-person-name"]')
const personRole = $('[data-testid="about-person-role"]')
const yearsEl = $('[data-testid="about-years"]')
const bodyEl = $('[data-testid="about-body"]')
const skillsEl = $('[data-testid="about-skills-list"]')
const toolsEl = $('[data-testid="about-tools-list"]')

const initialFrom = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'JS'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const applyAboutSettings = (s = {}) => {
  if (!section) return
  if (eyebrow) eyebrow.textContent = s.about_eyebrow || 'About me'
  if (titlePre) titlePre.textContent = s.about_heading_pre || 'Designing at the'
  if (titleEm) titleEm.textContent = s.about_heading_emphasis || 'intersection of art & function'

  // Photo
  if (photoFrame) {
    if (s.about_photo_url) {
      photoImg.src = s.about_photo_url
      photoImg.alt = s.about_person_name || ''
      photoFrame.classList.add('has-image')
    } else {
      photoImg.removeAttribute('src')
      photoImg.alt = ''
      photoFrame.classList.remove('has-image')
    }
  }
  if (photoFallback) photoFallback.textContent = initialFrom(s.about_person_name)

  if (personName) personName.textContent = s.about_person_name || 'Wade Jackson'
  if (personRole) personRole.textContent = s.about_person_role || 'Graphic & Web Designer'
  if (yearsEl) {
    const y = (typeof s.about_years === 'number') ? s.about_years : 9
    yearsEl.textContent = `${y} year${y === 1 ? '' : 's'} experience`
  }

  // Body — split on blank lines into paragraphs
  if (bodyEl) {
    const text = s.about_body || ''
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    bodyEl.innerHTML = paragraphs.length
      ? paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
      : '<p>Add your bio in the admin panel under Page 5 → About me.</p>'
  }

  // Skills — array of {name, pct}
  if (skillsEl) {
    const skills = Array.isArray(s.about_skills) ? s.about_skills : []
    skillsEl.innerHTML = skills.map((sk) => {
      const pct = Math.max(0, Math.min(100, parseInt(sk.pct, 10) || 0))
      return `
        <div class="about-skill" style="--pct: ${pct}%;">
          <div class="about-skill__head">
            <span class="about-skill__name">${escapeHtml(sk.name)}</span>
            <span class="about-skill__pct">${pct}%</span>
          </div>
          <div class="about-skill__bar"><div class="about-skill__fill"></div></div>
        </div>
      `
    }).join('')
  }

  // Tools
  if (toolsEl) {
    const tools = Array.isArray(s.about_tools) ? s.about_tools : []
    toolsEl.innerHTML = tools.map((t) => `<span class="about-tool">${escapeHtml(t)}</span>`).join('')
  }
}

export const revealAboutSection = () => {
  if (!section) return
  section.classList.add('is-active')
  section.setAttribute('aria-hidden', 'false')
  document.documentElement.classList.add('is-scrollable')
  document.body.classList.add('is-scrollable')
  // Scroll to About's position. We use getBoundingClientRect+scrollY because
  // about's offsetTop can read 0 due to margin-collapsing through the
  // ancestor chain (main has no padding/border, so about's `margin-top: 100vh`
  // collapses with main's margin and offsetTop becomes 0).
  const doScroll = () => {
    const rect = section.getBoundingClientRect()
    const top = rect.top + window.scrollY
    if (top > 1) window.scrollTo(0, top)
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      doScroll()
      // Re-attempt once more after a beat in case the first call raced layout
      setTimeout(doScroll, 80)
    })
  })
}

export const hideAboutSection = () => {
  if (!section) return
  section.classList.remove('is-active')
  section.setAttribute('aria-hidden', 'true')
}
