/**
 * projects.js — fetches /api/projects, renders the past-projects grid,
 * and adds a 3D-tilt hover effect on each card.
 */

const apiUrl = (p) => p

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const grid = document.querySelector('[data-testid="projects-grid"]')
const section = document.querySelector('[data-testid="projects-section"]')
const empty = document.querySelector('[data-testid="projects-empty"]')

const initialFromTitle = (title) => {
  const cleaned = String(title || '').trim().replace(/[^A-Za-z0-9]/g, '')
  return cleaned ? cleaned[0].toUpperCase() : '?'
}

let _projectsCache = []

const renderCard = (project) => {
  const card = document.createElement('article')
  card.className = 'project-card'
  card.setAttribute('data-testid', `project-card-${project.id}`)
  const hasImage = project.image_url && project.image_url.length > 0
  const imageInner = hasImage
    ? `<img src="${escapeHtml(project.image_url)}" alt="${escapeHtml(project.title)}" loading="lazy" />`
    : `<span class="project-card__placeholder">${escapeHtml(initialFromTitle(project.title))}</span>`
  card.innerHTML = `
    <div class="project-card__image">${imageInner}</div>
    <div class="project-card__overlay">
      <p class="project-card__year">${escapeHtml(project.year || '')}</p>
      <h3 class="project-card__title">${escapeHtml(project.title || '')}</h3>
      <p class="project-card__desc">${escapeHtml(project.description || '')}</p>
    </div>
  `
  attachTilt(card)
  return card
}

/** 3D tilt effect — track mouse and apply rotateX/rotateY based on relative position. */
const attachTilt = (card) => {
  let raf = null
  const target = { rx: 0, ry: 0, scale: 1 }
  const current = { rx: 0, ry: 0, scale: 1 }
  let entered = false

  const apply = () => {
    current.rx += (target.rx - current.rx) * 0.18
    current.ry += (target.ry - current.ry) * 0.18
    current.scale += (target.scale - current.scale) * 0.18
    card.style.transform = `perspective(1100px) rotateX(${current.rx}deg) rotateY(${current.ry}deg) scale(${current.scale.toFixed(3)})`
    if (entered || Math.abs(target.rx - current.rx) > 0.05 || Math.abs(target.ry - current.ry) > 0.05) {
      raf = requestAnimationFrame(apply)
    } else {
      card.style.transform = ''
      raf = null
    }
  }

  card.addEventListener('mouseenter', () => {
    entered = true
    target.scale = 1.02
    if (!raf) raf = requestAnimationFrame(apply)
  })
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width  // 0..1
    const y = (e.clientY - rect.top) / rect.height  // 0..1
    target.ry = (x - 0.5) * 12   // -6..+6 deg
    target.rx = (0.5 - y) * 9    // +4.5..-4.5 deg
    if (!raf) raf = requestAnimationFrame(apply)
  })
  card.addEventListener('mouseleave', () => {
    entered = false
    target.rx = 0
    target.ry = 0
    target.scale = 1
    if (!raf) raf = requestAnimationFrame(apply)
  })
}

export const fetchAndRenderProjects = async () => {
  if (!grid) return
  try {
    const res = await fetch(apiUrl('/api/projects'))
    const projects = await res.json()
    _projectsCache = Array.isArray(projects) ? projects : []
  } catch (e) {
    _projectsCache = []
  }
  grid.innerHTML = ''
  if (_projectsCache.length === 0) {
    if (empty) empty.hidden = false
    return
  }
  if (empty) empty.hidden = true
  _projectsCache.forEach((p) => grid.appendChild(renderCard(p)))
}

/** Show the projects section (display:block + body scrollable) */
export const revealProjectsSection = () => {
  if (!section) return
  section.classList.add('is-active')
  section.setAttribute('aria-hidden', 'false')
  document.documentElement.classList.add('is-scrollable')
  document.body.classList.add('is-scrollable')
  // scroll to it
  requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

/** Re-render after admin changes */
export const reloadProjects = () => fetchAndRenderProjects()
