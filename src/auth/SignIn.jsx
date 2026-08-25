import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Boxes, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Volume2, VolumeX, Wrench } from 'lucide-react'

/* =========================================================================
   Sign in — machine-yard intro, then the workspace gate.

   An excavator tracks across a grade line and the product name is revealed
   letter by letter as the bucket clears it, so the title reads as something
   the machine graded rather than something that faded in. Colours come from
   the --ams-* tokens in src/index.css, so this screen re-skins with the rest
   of the product.

   The timeline below is the only thing you normally need to touch.
   ========================================================================= */
const T = { enter: 420, travel: 2600, hold: 760, exit: 620 }
const TITLE_TRIGGER = 0.42 // reveal a letter once the bucket clears 42% of it
const BUCKET_AT = 0.86 // bucket tip, as a fraction of the machine's width
const CLEAR = 30 // extra travel so it enters and leaves fully off-screen
const FAILSAFE = 9000 // never trap the user behind a stalled intro

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const introParam = () => {
  if (typeof window === 'undefined') return null
  const m = /[?&]intro=([01])/.exec(window.location.search)
  return m ? m[1] : null
}

/* The intro is part of arriving at the page, so it runs on every load and a
   refresh replays it. Reduced-motion skips it; ?intro=0 skips it for anyone
   iterating on the form itself, and ?intro=1 forces it back on. */
const playIntro = () => {
  const forced = introParam()
  if (forced === '1') return true
  if (forced === '0') return false
  return !reducedMotion()
}

const SOUND_KEY = 'am.intro.sound'

/* On by default - only an explicit mute turns it off. */
const soundPreferred = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    return true
  }
}

const rememberSound = (on) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0')
  } catch {
    /* private mode - the choice just does not survive the session */
  }
}

/* Heavy-equipment audio, synthesised rather than shipped as a file: a detuned
   low pair through a lowpass for the diesel block, an amplitude LFO for the
   cylinder chug, and band-passed noise for track rattle. The pass-by is shaped
   to the travel - louder and brighter as the machine nears, then falling away
   with a slight pitch drop as it leaves, which is what sells it as a machine
   crossing in front of you rather than a loop. */
const createMachineAudio = () => {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) return null

  let ctx = null
  let master = null
  let lowpass = null
  let block = null
  let stopped = false

  const build = () => {
    ctx = new Ctx()
    /* A limiter ahead of the output lets the master run hot without clipping,
       which is what actually makes this read as loud rather than just peaky. */
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.knee.value = 12
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(ctx.destination)

    master = ctx.createGain()
    master.gain.value = 0.0001
    master.connect(limiter)

    lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 200
    lowpass.Q.value = 5
    lowpass.connect(master)

    const engine = ctx.createGain()
    engine.gain.value = 0.62
    engine.connect(lowpass)

    block = ctx.createOscillator()
    block.type = 'sawtooth'
    block.frequency.value = 40
    const second = ctx.createOscillator()
    second.type = 'square'
    second.frequency.value = 27
    const mix = ctx.createGain()
    mix.gain.value = 0.6
    block.connect(mix)
    second.connect(mix)
    mix.connect(engine)

    /* cylinder firing, as amplitude modulation on the block */
    const chug = ctx.createOscillator()
    chug.type = 'sawtooth'
    chug.frequency.value = 8.5
    const chugDepth = ctx.createGain()
    chugDepth.gain.value = 0.45
    chug.connect(chugDepth)
    chugDepth.connect(engine.gain)

    /* track rattle over gravel */
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    const rattle = ctx.createBufferSource()
    rattle.buffer = buffer
    rattle.loop = true
    const grit = ctx.createBiquadFilter()
    grit.type = 'bandpass'
    grit.frequency.value = 1500
    grit.Q.value = 0.7
    const rattleGain = ctx.createGain()
    rattleGain.gain.value = 0.1
    rattle.connect(grit)
    grit.connect(rattleGain)
    rattleGain.connect(master)

    block.start()
    second.start()
    chug.start()
    rattle.start()
  }

  return {
    /* Resolves false when the browser refuses to start without a gesture. */
    async start(ms) {
      if (stopped) return false
      if (!ctx) build()
      try {
        await ctx.resume()
      } catch {
        return false
      }
      if (ctx.state !== 'running') return false

      const now = ctx.currentTime
      const mid = now + (ms * 0.5) / 1000
      const end = now + ms / 1000
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(0.0001, now)
      master.gain.exponentialRampToValueAtTime(1.15, mid)
      master.gain.exponentialRampToValueAtTime(0.0001, end)
      lowpass.frequency.cancelScheduledValues(now)
      lowpass.frequency.setValueAtTime(180, now)
      lowpass.frequency.linearRampToValueAtTime(900, mid)
      lowpass.frequency.linearRampToValueAtTime(200, end)
      /* a touch of Doppler: holds pitch on approach, drops as it goes by */
      block.frequency.cancelScheduledValues(now)
      block.frequency.setValueAtTime(44, now)
      block.frequency.linearRampToValueAtTime(44, mid)
      block.frequency.linearRampToValueAtTime(34, end)
      return true
    },
    stop() {
      stopped = true
      if (!ctx) return
      try {
        const now = ctx.currentTime
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now)
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
        setTimeout(() => { ctx.close().catch(() => {}) }, 320)
      } catch {
        ctx.close().catch(() => {})
      }
    },
  }
}

const INTRO_TITLE = 'ASSET MANAGEMENT SYSTEM'

/* The travel is a CSS animation on `left`, deliberately not on `transform`:
   Chrome promotes a transform animation to its own compositor layer, and that
   layer can advance on a different clock from the grade line and the letter
   reveals - which is exactly how the machine ended up frozen off-screen.
   `left` costs a layout per frame, which is nothing for one element over 2.6s,
   and it keeps every part of the sequence on the same clock.

   Letter reveals are scheduled off the same easing curve, solved backwards for
   the moment the bucket reaches each one. */
const bezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t) => ((ay * t + by) * t + cy) * t
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    let t = x
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-5) break
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    return sampleY(t)
  }
}

const easeAt = bezier(0.65, 0, 0.35, 1)

/* time (0..1) at which the easing has produced `progress` of the distance */
const timeForProgress = (progress) => {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (easeAt(mid) < progress) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/* ---------------------------------------------------------------- machine */
const Excavator = () => (
  <svg className="am-exc" viewBox="0 0 340 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="amx-mtl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFE99B" />
        <stop offset=".48" stopColor="#FFCD11" />
        <stop offset="1" stopColor="#8A6F0C" />
      </linearGradient>
      <linearGradient id="amx-mtl2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFDF72" />
        <stop offset="1" stopColor="#7E640A" />
      </linearGradient>
      <linearGradient id="amx-glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#39404B" />
        <stop offset=".55" stopColor="#11141A" />
        <stop offset="1" stopColor="#454D59" />
      </linearGradient>
      <radialGradient id="amx-shd">
        <stop offset="0" stopColor="#000" stopOpacity=".6" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>

    <ellipse cx="152" cy="205" rx="124" ry="10" fill="url(#amx-shd)" />

    <g className="am-exc__bounce">
      <ellipse className="am-smoke" cx="104" cy="92" rx="7" ry="6" fill="#C9BCA0" />
      <ellipse className="am-smoke" cx="104" cy="92" rx="7" ry="6" fill="#C9BCA0" />
      <ellipse className="am-smoke" cx="104" cy="92" rx="7" ry="6" fill="#C9BCA0" />

      <g>
        <rect x="34" y="152" width="212" height="48" rx="24" fill="#16140E" stroke="#3E3524" strokeWidth="2" />
        <rect
          className="am-cleats" x="34" y="152" width="212" height="48" rx="24" fill="none"
          stroke="rgba(255,205,17,.5)" strokeWidth="3.4" strokeDasharray="5 11" strokeLinecap="round"
        />
        <circle cx="128" cy="186" r="7" fill="#241F16" stroke="#4B4029" strokeWidth="1.6" />
        <circle cx="164" cy="186" r="7" fill="#241F16" stroke="#4B4029" strokeWidth="1.6" />
        <circle cx="92" cy="186" r="7" fill="#241F16" stroke="#4B4029" strokeWidth="1.6" />
        <circle cx="60" cy="176" r="16" fill="#221E15" stroke="#59492A" strokeWidth="2" />
        <circle cx="222" cy="176" r="16" fill="#221E15" stroke="#59492A" strokeWidth="2" />
        <g className="am-hub am-hub--a" stroke="rgba(255,205,17,.55)" strokeWidth="2.4" strokeLinecap="round">
          <path d="M60 165v22M49 176h22M52.5 168.5l15 15M67.5 168.5l-15 15" />
        </g>
        <g className="am-hub am-hub--b" stroke="rgba(255,205,17,.55)" strokeWidth="2.4" strokeLinecap="round">
          <path d="M222 165v22M211 176h22M214.5 168.5l15 15M229.5 168.5l-15 15" />
        </g>
      </g>

      <rect x="50" y="138" width="180" height="16" rx="5" fill="#2A2412" stroke="#584A2B" strokeWidth="1.6" />

      <path
        d="M56 138 L56 116 Q56 108 66 108 L126 108 L126 88 Q126 81 134 81 L182 81 Q191 81 191 90 L191 138 Z"
        fill="url(#amx-mtl)" stroke="#6E5116" strokeWidth="1.6" strokeLinejoin="round"
      />
      <path d="M56 130 L191 130" stroke="rgba(70,50,10,.35)" strokeWidth="1.4" />
      <rect x="59" y="112" width="18" height="24" rx="3" fill="#3B2F10" opacity=".55" />
      <rect x="133" y="88" width="50" height="30" rx="4" fill="url(#amx-glass)" stroke="#6E5116" strokeWidth="1.4" />
      <path d="M137 114 L173 90" stroke="rgba(255,255,255,.16)" strokeWidth="5" strokeLinecap="round" />
      <rect x="100" y="86" width="8" height="22" rx="2.5" fill="#2E2711" stroke="#5A4A28" strokeWidth="1.4" />
      <circle cx="186" cy="126" r="4" fill="#FFF3CE" opacity=".85" />

      <g className="am-boom">
        <path d="M190 124 L246 62" stroke="url(#amx-mtl2)" strokeWidth="19" strokeLinecap="round" />
        <path d="M190 124 L246 62" stroke="rgba(255,240,196,.28)" strokeWidth="4" strokeLinecap="round" />
        <path d="M178 130 L214 100" stroke="#3A3116" strokeWidth="8" strokeLinecap="round" />
        <path d="M196 118 L216 101" stroke="#C7C2B4" strokeWidth="4" strokeLinecap="round" />

        <g className="am-stick">
          <path d="M246 62 L286 108" stroke="url(#amx-mtl2)" strokeWidth="14" strokeLinecap="round" />
          <path d="M246 62 L286 108" stroke="rgba(255,240,196,.25)" strokeWidth="3" strokeLinecap="round" />
          <path d="M240 76 L268 70" stroke="#3A3116" strokeWidth="7" strokeLinecap="round" />
          <circle cx="246" cy="62" r="5.5" fill="#2A2411" stroke="#7A5C1C" strokeWidth="2" />

          <g className="am-bucket">
            <path
              d="M276 100 L300 100 L308 120 Q296 134 280 127 Z"
              fill="url(#amx-mtl)" stroke="#6E5116" strokeWidth="1.6" strokeLinejoin="round"
            />
            <path d="M303 111 l7 4 M306 118 l7 3 M299 105 l7 4" stroke="#FFE04D" strokeWidth="3.2" strokeLinecap="round" />
            <circle cx="286" cy="108" r="5" fill="#2A2411" stroke="#7A5C1C" strokeWidth="2" />
          </g>
        </g>
      </g>

      <ellipse className="am-dust" cx="52" cy="198" rx="11" ry="7" fill="#8C7F63" opacity="0" />
      <ellipse className="am-dust" cx="74" cy="200" rx="9" ry="6" fill="#8C7F63" opacity="0" />
      <ellipse className="am-dust" cx="40" cy="201" rx="13" ry="7" fill="#8C7F63" opacity="0" />
      <ellipse className="am-dust" cx="88" cy="199" rx="8" ry="5" fill="#8C7F63" opacity="0" />
    </g>
  </svg>
)

/* ----------------------------------------------------------------- intro */
function Intro({ onDone }) {
  const introRef = useRef(null)
  const stageRef = useRef(null)
  const rigRef = useRef(null)
  const gradeRef = useRef(null)
  const finishRef = useRef(null)
  const playRef = useRef(null)
  const audioRef = useRef(null)
  const soundRef = useRef(soundPreferred())
  const startedAtRef = useRef(0)
  const [sound, setSound] = useState(soundPreferred)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const intro = introRef.current
    const stage = stageRef.current
    const rig = rigRef.current
    const grade = gradeRef.current
    if (!intro || !stage || !rig || !grade) return undefined

    const letters = Array.from(stage.querySelectorAll('.am-lw'))
    const timers = []
    let done = false

    let dropGesture = null
    let blockedNow = false

    const remaining = () => T.enter + T.travel - (performance.now() - startedAtRef.current)

    /* Chrome refuses to start audio before a gesture. Rather than give up, arm
       the very next interaction of any kind - a click anywhere, a keypress,
       a touch - and pick the engine up from wherever the travel has got to. */
    const armGesture = () => {
      if (dropGesture || done) return
      const unlock = () => {
        dropGesture?.()
        /* no-op when the engine already started - this only exists to rescue a
           refused autoplay */
        if (done || !soundRef.current || !blockedNow) return
        const left = remaining()
        if (left > 250) playAudio(left)
      }
      const opts = { capture: true, once: true }
      window.addEventListener('pointerdown', unlock, opts)
      window.addEventListener('keydown', unlock, opts)
      window.addEventListener('touchstart', unlock, opts)
      dropGesture = () => {
        window.removeEventListener('pointerdown', unlock, true)
        window.removeEventListener('keydown', unlock, true)
        window.removeEventListener('touchstart', unlock, true)
        dropGesture = null
      }
    }

    const playAudio = (ms) => {
      audioRef.current = audioRef.current || createMachineAudio()
      audioRef.current?.start(ms)
        .then((ok) => { blockedNow = !ok; setBlocked(!ok); if (!ok) armGesture() })
        .catch(() => { blockedNow = true; setBlocked(true); armGesture() })
      armGesture() // armed up front so a click in the first frames still counts
    }
    playRef.current = playAudio

    const start = () => {
      const stageW = stage.clientWidth
      const rigW = rig.offsetWidth
      if (!stageW || !rigW) return // laid out yet? the failsafe still covers us

      const side = Math.max(0, (window.innerWidth - stageW) / 2)
      const from = -(rigW + side + CLEAR)
      const to = stageW + side + CLEAR
      const span = to - from
      const bucketAt = (p) => from + span * p + rigW * BUCKET_AT

      /* the machine */
      rig.style.setProperty('--rig-from', `${from.toFixed(1)}px`)
      rig.style.setProperty('--rig-to', `${to.toFixed(1)}px`)
      rig.style.setProperty('--travel-dur', `${T.travel}ms`)
      rig.style.setProperty('--travel-delay', `${T.enter}ms`)

      /* the graded line, locked to the bucket by sharing from/to and easing.
         It scales the full band rather than growing a width, so both ends are
         fractions of the stage — and the far end is clamped, since the bucket
         carries on past the edge. */
      const reach = (p) => Math.min(1, Math.max(0, bucketAt(p) / stageW))
      grade.style.setProperty('--grade-from', reach(0).toFixed(4))
      grade.style.setProperty('--grade-to', reach(1).toFixed(4))
      grade.style.setProperty('--travel-dur', `${T.travel}ms`)
      grade.style.setProperty('--travel-delay', `${T.enter}ms`)

      /* one reveal per letter, timed to the moment the bucket clears it */
      const base = stage.getBoundingClientRect().left
      const rows = {}
      const marks = letters.map((el) => {
        const r = el.getBoundingClientRect()
        rows[Math.round(r.top)] = 1
        return { el, at: r.left - base + r.width * TITLE_TRIGGER }
      })
      const wrapped = Object.keys(rows).length > 1
      marks.forEach((m, idx) => {
        /* A wrapped title makes x meaningless for line two, so fall back to an
           even spread across the same travel. */
        const progress = wrapped
          ? (idx + 0.4) / marks.length
          : (m.at - rigW * BUCKET_AT - from) / span
        const delay = T.enter + timeForProgress(Math.min(1, Math.max(0, progress))) * T.travel
        const glyph = m.el.firstElementChild
        if (glyph) glyph.style.transitionDelay = `${Math.round(delay)}ms`
      })

      rig.classList.add('is-go')
      grade.classList.add('is-go')
      startedAtRef.current = performance.now()
      if (soundRef.current) playAudio(T.enter + T.travel)
      /* next frame so the delays are in place before the transition arms */
      timers.push(setTimeout(() => letters.forEach((el) => el.classList.add('is-on')), 20))
      timers.push(setTimeout(() => finish(false), T.enter + T.travel + 40))
    }

    const handOff = () => {
      intro.classList.add('is-out')
      onDone()
      timers.push(setTimeout(() => { intro.style.display = 'none' }, T.exit))
    }

    function finish(immediate) {
      if (done) return
      done = true
      letters.forEach((el) => {
        /* Skipping should land the title at once; the natural end lets the
           tail of the cascade finish rising in the machine's wake. */
        if (immediate) {
          const glyph = el.firstElementChild
          if (glyph) glyph.style.transitionDelay = '0ms'
        }
        el.classList.add('is-on')
      })
      if (immediate) {
        rig.classList.remove('is-go')
        grade.classList.remove('is-go')
        grade.classList.add('is-full')
      }
      intro.classList.add('is-done')
      if (immediate) audioRef.current?.stop()
      timers.push(setTimeout(handOff, immediate ? 90 : T.hold))
    }
    finishRef.current = finish

    const onKey = (e) => { if (e.key === 'Escape') finish(true) }
    document.addEventListener('keydown', onKey)

    /* Wait for the display face so letter widths measure correctly, but never
       wait on it indefinitely. */
    let started = false
    const go = () => {
      if (started || done) return
      started = true
      start()
    }
    if (document.fonts?.ready) {
      const guard = setTimeout(go, 600)
      timers.push(guard)
      document.fonts.ready.then(() => { clearTimeout(guard); go() }).catch(go)
    } else {
      go()
    }

    timers.push(setTimeout(() => finish(true), FAILSAFE))

    return () => {
      timers.forEach(clearTimeout)
      document.removeEventListener('keydown', onKey)
      dropGesture?.()
      audioRef.current?.stop()
      audioRef.current = null
    }
  }, [onDone])

  const words = INTRO_TITLE.split(' ')

  return (
    <div className="am-intro" ref={introRef} role="status" aria-label="Starting Asset Management System workspace">
      <span className="am-intro__grid" aria-hidden="true" />

      <div className="am-stage" ref={stageRef}>
        <h1 className="am-intro__title" aria-label="Asset Management System">
          {words.map((word, wi) => (
            <Fragment key={word + wi}>
              {wi > 0 && <span className="am-sp" aria-hidden="true" />}
              <span className="am-wd">
                {Array.from(word).map((ch, ci) => (
                  <span className="am-lw" key={`${ch}-${ci}`} aria-hidden="true">
                    <span className="am-lt">{ch}</span>
                  </span>
                ))}
              </span>
            </Fragment>
          ))}
        </h1>

        <div className="am-band">
          <span className="am-rule" aria-hidden="true" />
          <span className="am-grade" ref={gradeRef} aria-hidden="true" />
          <div className="am-rig" ref={rigRef} aria-hidden="true">
            <span className="am-rig__glow" />
            <Excavator />
          </div>
        </div>

        <p className="am-caption">
          <span className="am-caption__dot" aria-hidden="true" />
          <span className="am-caption__txt">Operations workspace</span>
        </p>
      </div>

      <button
        className={blocked ? 'am-sound is-blocked' : 'am-sound'}
        type="button"
        aria-pressed={sound}
        aria-label={sound ? 'Mute machine sound' : 'Play machine sound'}
        onClick={() => {
          const next = !sound
          setSound(next)
          soundRef.current = next
          setBlocked(false)
          rememberSound(next)
          if (!next) { audioRef.current?.stop(); audioRef.current = null; return }
          const left = T.enter + T.travel - (performance.now() - startedAtRef.current)
          if (left > 250) playRef.current?.(left)
        }}
      >
        {sound ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
        <span>{sound ? 'Sound on' : blocked ? 'Tap for sound' : 'Sound off'}</span>
      </button>

      <button className="am-skip" type="button" onClick={() => finishRef.current?.(true)}>
        Skip intro <kbd>Esc</kbd>
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ brand */
const Brand = ({ mobile = false }) => (
  <div className={mobile ? 'am-mark am-mark--mobile' : 'am-mark'}>
    <span className="am-mark__badge" aria-hidden="true">
      <img src="/ams-logo.png" alt="" width="52" height="52" />
    </span>
    <div>
      <p className="am-mark__name">Asset Management System</p>
      {mobile && <p className="am-mark__sub">Operations workspace</p>}
    </div>
  </div>
)

/* =========================================================================
   Asset globe — the brand panel's centrepiece.

   A dotted Earth turns behind a static wire cage: the land tile is drawn once
   and stamped four times, and the spin translates exactly one tile width, so
   the rotation loops seamlessly without shipping a texture. It is also
   draggable — see GlobeStage, which wraps the user's own rotation into a single
   tile so no amount of spinning can run off the end of the stamped copies.

   The register is not only machines, so the globe cycles the classes it holds
   — heavy equipment, then plant and tools, then IT and office. Each class gets
   its own sites, dispatch runs and chips, and the crossfade is timed to a third
   of a turn, so a full rotation of the Earth shows the whole register once.

   Geometry is fixed against the sphere at (300,200) r=158 in a 600x400 viewBox.
   The chips are HTML rather than SVG text, positioned as percentages of that
   same 600x400 box: a chip pinned at 72.5% meets the leader drawn to x=435,
   and its type can be sized in container units and shed its meta line on a
   narrow stage — neither of which SVG text can do.
   ========================================================================= */
const GLOBE = { cx: 300, cy: 200, r: 158 }
const TILE = 384 // land tile width; the spin translates exactly this far

/* latitudes: rx is the sphere's half-width at that height, ry the foreshortening */
const LATS = [-118, -62, 0, 62, 118].map((dy) => ({
  dy,
  rx: Math.sqrt(GLOBE.r * GLOBE.r - dy * dy),
}))

/* meridians read as a static cage the surface turns inside */

/* The four chip berths never move — only what sits in them does. `ey` is the
   height a leader meets the chip at, `x` the chip edge it lands on. */
const SLOTS = [
  { ey: 76, x: 165, left: '0%', top: '19%' },
  { ey: 104, x: 435, left: '72.5%', top: '26%' },
  { ey: 324, x: 165, left: '0%', top: '81%' },
  { ey: 300, x: 435, left: '72.5%', top: '75%' },
]

/* Where each berth's asset sits on the sphere: a longitude offset from its
   class's meridian, and a latitude that puts the pin below its chip (top
   berths) or above it (bottom berths), so a leader never runs through one. */
const BERTHS = [
  { lon: -22, lat: 34 },
  { lon: 20, lat: 19 },
  { lon: -20, lat: -30 },
  { lon: 22, lat: -18 },
]

/* Pins sit where the surface projects them; the band is barely compressed,
   which keeps the leaders from stretching across the whole face. */
const SPREAD = 0.98
/* How much a pin shrinks as it turns away: 1 dead ahead, DEPTH at the limb.
   This is the cue that makes the sites read as sitting ON a ball. */
const DEPTH = 0.58
/* Meridians and latitudes are both redrawn every frame. A latitude stays an
   axis-aligned ellipse under a lean, so it keeps its <ellipse>; a meridian
   does not — tipped, a great circle through the poles projects to a *rotated*
   ellipse, which an <ellipse> cannot express — so those are sampled paths. */
const MERIDIAN_LONS = [0, 30, 60, 90, 120, 150]
const RING_STEPS = 36
const RING_COS = Array.from({ length: RING_STEPS }, (_, i) => Math.cos((i / RING_STEPS) * Math.PI * 2))
const RING_SIN = Array.from({ length: RING_STEPS }, (_, i) => Math.sin((i / RING_STEPS) * Math.PI * 2))
const DRIFT = 0.0067 // degrees per ms — one turn in 54s, one class in 9s

/* The lean, in degrees above the equator. It rests slightly tipped toward you
   — sin 11 degrees is the 0.19 flattening the latitude rings were drawn with
   — and a vertical drag leans it inside a range that keeps both poles off the
   limb, where the fake surface would give itself away. */
const TILT_REST = 11
const TILT_MIN = -24
const TILT_MAX = 42
const clampTilt = (deg) => Math.max(TILT_MIN, Math.min(TILT_MAX, deg))

/* The flight. The orbit is the ellipse already drawn round the sphere; the
   airliner rides it at its own cruise plus a share of whatever the globe is
   turning, so a flick of the globe visibly hurries it along. */
const ORBIT = { rx: 216, ry: 70, tilt: -16 }
const NEAR = 0 // the two plane copies, near leg first
const FAR = 1
const CRUISE = 0.026 // degrees per ms — a lap in about 14s
const PLANE_SPIN = 0.5

const rad = (deg) => (deg * Math.PI) / 180
const wrap180 = (deg) => {
  const d = ((deg % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

/* Dispatch runs, bowed away from the centre so they arc over the face rather
   than cutting through it. The order skips the diagonal so the loop never
   crosses itself: top-left, top-right, bottom-right, bottom-left. */
const LOOP = [0, 1, 3, 2]

const run = (p, q) => {
  const mx = (p[0] + q[0]) / 2
  const my = (p[1] + q[1]) / 2
  const bow = 0.22
  const cx = (mx + (mx - GLOBE.cx) * bow).toFixed(1)
  const cy = (my + (my - GLOBE.cy) * bow).toFixed(1)
  return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q${cx} ${cy} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`
}

/* Asset glyphs, drawn on a 24x24 grid and stroked by the chip badge, so they
   take their colour from --on-gold rather than carrying their own. */
const GLYPHS = {
  exc: (
    <>
      <rect x="2.4" y="16.3" width="13.2" height="4.7" rx="2.35" />
      <path d="M5.3 16.3v-5h6.5v5" />
      <path d="M11.9 12.5l4.8-5.3 3.4 2.6" />
      <path d="M20.1 9.8l-.7 3.4-3.3-.7" />
    </>
  ),
  dozer: (
    <>
      <rect x="4.6" y="16.3" width="11.6" height="4.7" rx="2.35" />
      <path d="M6.8 16.3v-4.8h6.2v4.8" />
      <path d="M19.4 10.6v8.4" />
      <path d="M16.2 17.9l3.2-1.7" />
      <path d="M9.2 11.5V8.9" />
    </>
  ),
  truck: (
    <>
      <circle cx="7" cy="18.2" r="2.4" />
      <circle cx="16.9" cy="18.2" r="2.4" />
      <path d="M13.4 15.8v-5.3h3.1l2.6 3.2v4.5" />
      <path d="M3.4 15.8V9.2l8.8-1.7v8.3" />
      <path d="M9.4 18.2h5.1" />
    </>
  ),
  loader: (
    <>
      <circle cx="7.2" cy="17.5" r="2.9" />
      <circle cx="15.9" cy="17.5" r="2.9" />
      <path d="M4.7 14.6v-3.9h6.3v3.9" />
      <path d="M11 12.3l6.1 2.2" />
      <path d="M20.7 11.3v4.3l-3.6 1.1" />
    </>
  ),
  genset: (
    <>
      <rect x="2.6" y="7.6" width="18.8" height="11" rx="2.4" />
      <path d="M6.6 7.6V5.8h5v1.8" />
      <path d="M13.6 10.8h4.6M13.6 13.1h4.6M13.6 15.4h4.6" />
      <path d="M9.6 9.8l-2.8 4h3.2l-2 3.6" />
    </>
  ),
  drill: (
    <>
      <path d="M3.6 8.4h8.8a1.6 1.6 0 0 1 1.6 1.6v2.6a1.6 1.6 0 0 1-1.6 1.6H3.6z" />
      <path d="M14 10.2h3.2v2.2H14z" />
      <path d="M17.2 11.3h3.4" />
      <path d="M6.6 14.6l-1.2 5.8h3.6l.9-5.8" />
      <path d="M3.6 9.8H2" />
    </>
  ),
  compr: (
    <>
      <rect x="2.4" y="11.4" width="17.6" height="6.4" rx="3.2" />
      <circle cx="6.4" cy="19.9" r="1.4" />
      <circle cx="16" cy="19.9" r="1.4" />
      <path d="M8.6 11.4V8.2h4.4v3.2" />
      <path d="M17.6 11.1V8.6h2.9" />
    </>
  ),
  welder: (
    <>
      <rect x="2.6" y="8.6" width="10.4" height="9.4" rx="2" />
      <path d="M5 11.6h5.6M5 14.2h3.6" />
      <path d="M13 11.6c3 0 3.6 1.6 5.4 1.6" />
      <path d="M18.4 11.4l3.2 1.8-3.2 1.8z" />
      <path d="M20.2 9.2l1.4-1.6M18.4 8.4l.4-2" />
    </>
  ),
  laptop: (
    <>
      <path d="M5 7.6h14v8.2H5z" />
      <path d="M2.6 18.6h18.8l-1.7-2.8H4.3z" />
    </>
  ),
  printer: (
    <>
      <path d="M6.6 9.4V4.6h10.8v4.8" />
      <rect x="3" y="9.4" width="18" height="6.6" rx="1.8" />
      <path d="M6.6 16v3.8h10.8V16" />
      <circle cx="17.7" cy="12.2" r=".9" />
    </>
  ),
  server: (
    <>
      <rect x="4.6" y="3.4" width="14.8" height="17.2" rx="2" />
      <path d="M4.6 9.1h14.8M4.6 14.8h14.8" />
      <circle cx="8" cy="6.2" r=".85" />
      <circle cx="8" cy="11.9" r=".85" />
      <circle cx="8" cy="17.6" r=".85" />
    </>
  ),
  radio: (
    <>
      <rect x="6.6" y="7.4" width="10.8" height="13.2" rx="2.2" />
      <path d="M16 7.4V3.6" />
      <path d="M9.2 10.6h5.6" />
      <path d="M9.4 14h1.4M12.8 14h1.4M9.4 16.9h1.4M12.8 16.9h1.4" />
    </>
  ),
  crane: (
    <>
      <path d="M3.2 20.6h8.4" />
      <path d="M7.4 20.6V6.4" />
      <path d="M2.2 6.4h19.6" />
      <path d="M18.2 6.4v4.8" />
      <path d="M16.8 11.2h2.8" />
      <path d="M7.4 6.4l3.4-3" />
    </>
  ),
  roller: (
    <>
      <circle cx="7" cy="15.6" r="4.6" />
      <path d="M14.4 10.6h5.4v6.4a2.6 2.6 0 0 1-2.6 2.6h-2.8z" />
      <path d="M11.6 15.6h2.8" />
      <path d="M14.4 10.6V8h3.6" />
    </>
  ),
  mixer: (
    <>
      <circle cx="6.6" cy="18.4" r="2.2" />
      <circle cx="16.4" cy="18.4" r="2.2" />
      <path d="M2.6 16.2v-5.6h4.4l1.6 2.6" />
      <path d="M9.4 16.2l1.8-7.6 7.6 1.6-1.8 6.8z" />
      <path d="M8.8 18.4h5.4" />
    </>
  ),
  forklift: (
    <>
      <circle cx="6.4" cy="18" r="2.4" />
      <circle cx="13.2" cy="18" r="2.4" />
      <path d="M3.4 15.6V9.2h5.4v6.4" />
      <path d="M8.8 12.4h3.2v3.2" />
      <path d="M16.6 4.4v13.8" />
      <path d="M16.6 15.4h4.4" />
    </>
  ),
  moto: (
    <>
      <circle cx="5.4" cy="16.4" r="3.4" />
      <circle cx="18.6" cy="16.4" r="3.4" />
      <path d="M8.6 16.4l2.8-4.6h4.4l2.8 4.6" />
      <path d="M11.4 11.8H9l-1.6 2.6" />
      <path d="M13.6 9.2h3.2" />
    </>
  ),
  pickup: (
    <>
      <circle cx="7.4" cy="17.6" r="2.3" />
      <circle cx="16.8" cy="17.6" r="2.3" />
      <path d="M2.4 17.6v-4.8h4.2l2.2-3.6h4.6v8.4" />
      <path d="M13.4 12.8h8.2v4.8h-2.5" />
      <path d="M9.7 17.6h4.8" />
    </>
  ),
  van: (
    <>
      <circle cx="7.6" cy="17.8" r="2.2" />
      <circle cx="16.6" cy="17.8" r="2.2" />
      <path d="M2.6 17.8V7.8h11.2l5.6 4.8v5.2h-2.8" />
      <path d="M9.8 17.8h4.6" />
      <path d="M13.8 7.8v4.8h5.6" />
    </>
  ),
  car: (
    <>
      <circle cx="7.2" cy="17.4" r="2.2" />
      <circle cx="16.8" cy="17.4" r="2.2" />
      <path d="M2.6 17.4v-4.2l2.8-4.4h9.2l4.4 4.4h2.4v4.2h-1.6" />
      <path d="M9.4 17.4h5.2" />
      <path d="M5.4 13.2h13.6" />
    </>
  ),
  aircon: (
    <>
      <rect x="2.4" y="5.4" width="19.2" height="7.6" rx="2.2" />
      <path d="M5.4 10.2h13.2" />
      <path d="M6.6 16.2c1.5 0 1.5 2.2 3 2.2" />
      <path d="M12 16.2c1.5 0 1.5 2.2 3 2.2" />
      <path d="M17.4 16.2c1.1 0 1.4 1.2 2.2 1.9" />
    </>
  ),
  pump: (
    <>
      <circle cx="10.2" cy="13" r="4.6" />
      <path d="M10.2 8.4V5.2h4.6" />
      <path d="M14.8 13h5.6" />
      <path d="M4.2 20.4h12.4" />
      <path d="M10.2 17.6v2.8" />
    </>
  ),
  tower: (
    <>
      <rect x="6.4" y="3.4" width="11.2" height="4" rx="1.3" />
      <path d="M12 7.4v11.2" />
      <path d="M6.8 20.6h10.4" />
      <path d="M9 18.6h6" />
      <path d="M8.8 8.6h6.4" />
    </>
  ),
  tank: (
    <>
      <rect x="2.4" y="7.6" width="15.6" height="9" rx="4.5" />
      <path d="M7 7.6v9M13.4 7.6v9" />
      <path d="M5.4 16.6v3.4M15 16.6v3.4" />
      <path d="M18 10.6h3.6v5.4" />
    </>
  ),
}

/* One class per slice of the turn. Sites differ per class so the pins land
   somewhere new each time the carousel advances, and every class fills the
   same four berths — see PER_CLASS below. */
const CLASSES = [
  {
    key: 'heavy',
    label: 'Heavy equipment',
    items: [
      { g: 'exc', name: 'Excavator', meta: 'SITE 04 · WORKING' },
      { g: 'dozer', name: 'Bulldozer', meta: 'SITE 11 · WORKING' },
      { g: 'truck', name: 'Dump truck', meta: 'YARD 02 · HAULING' },
      { g: 'loader', name: 'Wheel loader', meta: 'SITE 07 · SERVICE' },
    ],
  },
  {
    key: 'site',
    label: 'Site plant',
    items: [
      { g: 'crane', name: 'Tower crane', meta: 'SITE 04 · LIFTING' },
      { g: 'roller', name: 'Road roller', meta: 'SITE 11 · COMPACTING' },
      { g: 'mixer', name: 'Concrete mixer', meta: 'YARD 02 · MIXING' },
      { g: 'forklift', name: 'Forklift', meta: 'STORE 01 · MOVING' },
    ],
  },
  {
    key: 'plant',
    label: 'Plant & tools',
    items: [
      { g: 'genset', name: 'Generator', meta: 'SITE 04 · RUNNING' },
      { g: 'drill', name: 'Power drill', meta: 'STORE 01 · ISSUED' },
      { g: 'compr', name: 'Compressor', meta: 'SITE 11 · IDLE' },
      { g: 'welder', name: 'Welding set', meta: 'YARD 02 · IN USE' },
    ],
  },
  {
    key: 'fleet',
    label: 'Vehicles & fleet',
    items: [
      { g: 'moto', name: 'Motorcycle', meta: 'FIELD · DISPATCHED' },
      { g: 'pickup', name: 'Pickup truck', meta: 'SITE 07 · ON RUN' },
      { g: 'van', name: 'Service van', meta: 'HQ · ASSIGNED' },
      { g: 'car', name: 'Staff car', meta: 'HQ · POOL' },
    ],
  },
  {
    key: 'facil',
    label: 'Facilities',
    items: [
      { g: 'aircon', name: 'Air conditioner', meta: 'HQ · COOLING' },
      { g: 'pump', name: 'Water pump', meta: 'SITE 07 · RUNNING' },
      { g: 'tower', name: 'Light tower', meta: 'SITE 11 · NIGHT' },
      { g: 'tank', name: 'Fuel tank', meta: 'YARD 02 · 68% FULL' },
    ],
  },
  {
    key: 'it',
    label: 'IT & office',
    items: [
      { g: 'laptop', name: 'Laptop', meta: 'HQ · ASSIGNED' },
      { g: 'printer', name: 'Printer', meta: 'HQ · ACTIVE' },
      { g: 'server', name: 'Server rack', meta: 'DATA ROOM · UP' },
      { g: 'radio', name: 'Radio unit', meta: 'SITE 07 · ISSUED' },
    ],
  },
]

/* Classes are spaced evenly round the sphere, so one revolution hands the
   berths through the whole register once. FULL and GONE — where a pin stops
   being fully lit, and where it goes — are fractions of that arc rather than
   fixed angles, so adding a class narrows the handover in step instead of
   leaving two classes lit in the same berths. GONE sits just past half the
   arc: far enough that the outgoing class is still fading as the incoming one
   starts — a crossfade rather than a blink — but close enough that two labels
   share a berth only briefly, which matters more now that a handover comes
   round twice as often. Both are inside a quarter turn, so a pin is always
   gone before it would reach the back of the sphere. */
const CLASS_ARC = 360 / CLASSES.length
const FULL = CLASS_ARC * 0.383
const GONE = CLASS_ARC * 0.56
const PER_CLASS = BERTHS.length

/* Every asset in the register, flattened and given a home on the sphere. The
   class index sets the meridian, the berth index sets the offset from it, so
   the four assets of a class arrive together and leave together. */
const ASSETS = CLASSES.flatMap(({ key, items }, cls) =>
  items.map((item, slot) => ({
    ...item,
    id: `${key}-${item.g}`,
    cls,
    slot,
    lon: -cls * CLASS_ARC + BERTHS[slot].lon,
    lat: BERTHS[slot].lat,
  }))
)

/* One tile of coastline. The outlines are drawn on a 288x236 grid and scaled
   to the sphere's 384x316; the dot pattern is defined pre-scale so it lands
   back on a 6-unit grid, keeping the texture density the same at any sphere
   size. 384 divides by that 6, so the stamped copies tile without a seam. */
const LandTile = () => (
  <g id="am-land" className="am-land">
    <g transform="scale(1.333,1.339)">
      <path d="M18 36C32 22 62 20 78 34c10 9 4 23-8 32-8 6-12 18-22 20-10 2-16-10-21-21-5-11-17-20-9-29Z" />
      <path d="M62 110c14-7 27 2 29 16 2 16-7 34-13 46-5 10-14 8-17-2-5-14-8-36-5-49 1-6 3-9 6-11Z" />
      <path d="M126 34c15-7 34-3 42 7 7 8 2 18-5 23 9 10 13 25 10 43-3 19-15 38-25 50-8 9-17 6-20-5-7-21-10-48-8-69 1-16 0-36 6-49Z" />
      <path d="M179 27c21-8 55-6 75 3 15 7 18 20 8 28-10 8-26 6-37 13-11 6-19 19-30 17-11-2-16-15-18-29-1-13-6-27 2-32Z" />
      <path d="M233 156c13-6 29-3 34 8 5 11-3 23-16 24-13 2-22-6-22-17 0-7 1-13 4-15Z" />
      <circle cx="100" cy="96" r="4" />
      <circle cx="206" cy="104" r="5" />
      <circle cx="274" cy="92" r="3.5" />
      <circle cx="44" cy="108" r="3" />
    </g>
  </g>
)

/* The airliner. Drawn nose along +x and centred on its own origin, so the
   pass can drop it anywhere on the orbit with one translate/rotate/scale. It
   is rendered twice — once behind the sphere, once in front — and the pass
   shows whichever copy matches the half of the orbit it is currently on, so
   the globe occludes it on the far leg and it flies over the face on the near
   one. That swap happens out at the ellipse's extremes, well clear of the
   sphere, so the flight reads as continuous. */
const Plane = ({ innerRef, far = false }) => (
  <g ref={innerRef} className={far ? 'am-plane am-plane--far' : 'am-plane'} style={{ opacity: 0 }}>
    <path className="am-plane__trail" d="M-13 0H-38" />
    <path
      className="am-plane__body"
      d="M11 0 L4 -1.5 L2 -1.6 L-3 -9 L-5 -9 L-2 -1.8 L-7 -1.8 L-9.5 -4.5 L-11 -4.5
         L-10.5 -1.2 L-11.5 0 L-10.5 1.2 L-11 4.5 L-9.5 4.5 L-7 1.8 L-2 1.8 L-5 9
         L-3 9 L2 1.6 L4 1.5 Z"
    />
  </g>
)

const AssetGlobe = ({ landRef, lats, mers, sites, pins, leads, glows, pulses, flows, nearPlane, farPlane }) => (
  <svg
    className="am-globe__svg" viewBox="0 0 600 400"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"
  >
    <defs>
      <clipPath id="am-sphere-clip">
        <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} />
      </clipPath>

      <pattern id="am-dots" width="4.5" height="4.5" patternUnits="userSpaceOnUse">
        <circle cx="1.35" cy="1.35" r=".93" fill="rgba(255,205,17,.74)" />
      </pattern>

      <radialGradient id="am-body" cx="34%" cy="27%" r="84%">
        <stop offset="0%" stopColor="#22262d" />
        <stop offset="54%" stopColor="#14171b" />
        <stop offset="100%" stopColor="#0a0c0e" />
      </radialGradient>

      <radialGradient id="am-halo">
        <stop offset="60%" stopColor="rgba(255,205,17,0)" />
        <stop offset="82%" stopColor="rgba(255,205,17,.15)" />
        <stop offset="100%" stopColor="rgba(255,205,17,0)" />
      </radialGradient>

      {/* the land fades toward the limb, which is what makes it read as a ball */}
      <radialGradient id="am-limb-grad">
        <stop offset="0%" stopColor="#fff" stopOpacity="1" />
        <stop offset="66%" stopColor="#fff" stopOpacity=".94" />
        <stop offset="88%" stopColor="#fff" stopOpacity=".6" />
        <stop offset="100%" stopColor="#fff" stopOpacity=".2" />
      </radialGradient>
      <mask id="am-limb">
        <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#am-limb-grad)" />
      </mask>

      <radialGradient id="am-sheen" cx="30%" cy="24%" r="62%">
        <stop offset="0%" stopColor="rgba(255,205,17,.16)" />
        <stop offset="100%" stopColor="rgba(255,205,17,0)" />
      </radialGradient>

      {/* the terminator: light sits up and to the left, so the far limb falls
          away into shadow. This is what turns a flat disc into a ball. */}
      <radialGradient id="am-shade" cx="32%" cy="26%" r="78%">
        <stop offset="0%" stopColor="rgba(0,0,0,0)" />
        <stop offset="52%" stopColor="rgba(0,0,0,.14)" />
        <stop offset="80%" stopColor="rgba(0,0,0,.44)" />
        <stop offset="100%" stopColor="rgba(0,0,0,.78)" />
      </radialGradient>

      {/* a thin bright edge where the surface curves away — atmosphere */}
      <radialGradient id="am-fresnel">
        <stop offset="80%" stopColor="rgba(255,205,17,0)" />
        <stop offset="95%" stopColor="rgba(255,205,17,.26)" />
        <stop offset="100%" stopColor="rgba(255,205,17,.04)" />
      </radialGradient>

      <radialGradient id="am-pin-glow">
        <stop offset="0%" stopColor="rgba(255,205,17,.5)" />
        <stop offset="50%" stopColor="rgba(255,205,17,.14)" />
        <stop offset="100%" stopColor="rgba(255,205,17,0)" />
      </radialGradient>

      <LandTile />
    </defs>

    {/* orbit and the far leg of the flight, behind the sphere so the near
        half of the globe occludes them */}
    <g transform={`rotate(${ORBIT.tilt} ${GLOBE.cx} ${GLOBE.cy})`}>
      <ellipse className="am-orbit" cx={GLOBE.cx} cy={GLOBE.cy} rx={ORBIT.rx} ry={ORBIT.ry} />
      <Plane innerRef={farPlane} far />
    </g>

    <circle cx={GLOBE.cx} cy={GLOBE.cy} r="200" fill="url(#am-halo)" />
    <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#am-body)" />

    {/* the turning surface */}
    <g clipPath="url(#am-sphere-clip)" mask="url(#am-limb)">
      <g className="am-land__spin" ref={landRef}>
        {[-TILE, 0, TILE, TILE * 2].map((x) => (
          <use key={x} href="#am-land" x={x} y={GLOBE.cy - GLOBE.r} />
        ))}
      </g>
    </g>

    {/* wire cage */}
    <g clipPath="url(#am-sphere-clip)">
      {LATS.map(({ dy, rx }, i) => (
        <ellipse
          key={dy} className={dy === 0 ? 'am-wire am-wire--eq' : 'am-wire'}
          ref={(el) => { lats.current[i] = el }}
          cx={GLOBE.cx} cy={GLOBE.cy + dy} rx={rx} ry={rx * 0.19}
        />
      ))}
      {MERIDIAN_LONS.map((lon, i) => (
        <path key={lon} className="am-wire" ref={(el) => { mers.current[i] = el }} />
      ))}
      <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#am-sheen)" />
      <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#am-shade)" />
    </g>
    <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#am-fresnel)" />
    <circle className="am-rim" cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} />

    {/* Dispatch runs, one set per class; the endpoints move with the pins, so
        their paths are rebuilt every frame alongside them. */}
    {CLASSES.map(({ key }, c) => (
      <g key={key} ref={(el) => { flows.current[c] = el }} style={{ opacity: 0 }}>
        {LOOP.map((slot) => (
          <g key={slot} style={{ '--d': `${slot * 0.9}s` }}>
            <path className="am-flow" ref={(el) => { flows.current[`${c}.${slot}a`] = el }} />
            <path className="am-flow__halo" pathLength="100" ref={(el) => { flows.current[`${c}.${slot}b`] = el }} />
            <path className="am-flow__hot" pathLength="100" ref={(el) => { flows.current[`${c}.${slot}c`] = el }} />
          </g>
        ))}
      </g>
    ))}

    {/* A site rides the surface: the leader is redrawn from wherever its pin
        has turned to, straight out to the berth its chip never leaves. */}
    {ASSETS.map((a, i) => (
      <g key={a.id} ref={(el) => { sites.current[i] = el }} style={{ opacity: 0 }}>
        <path className="am-lead__glow" ref={(el) => { glows.current[i] = el }} />
        <path className="am-lead" ref={(el) => { leads.current[i] = el }} />
        {/* a charge running pin -> chip, so the tether reads as a live link */}
        <path
          className="am-lead__pulse" pathLength="100"
          style={{ '--d': `${a.slot * 0.6}s` }}
          ref={(el) => { pulses.current[i] = el }}
        />
        <g ref={(el) => { pins.current[i] = el }} style={{ '--d': `${0.18 + a.slot * 0.12}s` }}>
          <circle className="am-pin__glow" r="19" />
          <circle className="am-pin__ping" r="7" />
          <circle className="am-pin__ping am-pin__ping--b" r="7" />
          <circle className="am-pin__ring" r="6.4" />
          <circle className="am-pin__dot" r="3.4" />
        </g>
      </g>
    ))}

    {/* the near leg of the flight, over the face */}
    <g transform={`rotate(${ORBIT.tilt} ${GLOBE.cx} ${GLOBE.cy})`}>
      <Plane innerRef={nearPlane} />
    </g>
  </svg>
)

/* The chips ride above the SVG in HTML, addressed to the same 600x400 grid.
   Each is anchored by its vertical centre, so a chip that sheds its meta line
   on a narrow stage still meets its leader exactly. A chip holds its berth and
   fades with its own pin, so rotating the globe swaps what the berth shows
   without ever moving the berth. */
const AssetChips = ({ chips }) => (
  <>
    {ASSETS.map((a, i) => (
      <div
        className="am-chip" key={a.id} ref={(el) => { chips.current[i] = el }}
        style={{ left: SLOTS[a.slot].left, top: SLOTS[a.slot].top, opacity: 0 }}
      >
        <span className="am-chip__badge">
          <svg className="am-chip__gl" viewBox="0 0 24 24" aria-hidden="true">{GLYPHS[a.g]}</svg>
        </span>
        <span className="am-chip__txt">
          <span className="am-chip__name">{a.name}</span>
          <span className="am-chip__meta">{a.meta}</span>
        </span>
      </div>
    ))}
  </>
)


/* Drag-to-rotate, and everything the rotation drives.

   One angle governs the whole graphic. The land, the pins, the leaders, the
   dispatch runs, the chips and the class caption are all derived from `turn`
   in a single rAF pass, which is the only way they can stay in step — a CSS
   animation for the land and a JS projection for the pins would run off two
   clocks and drift apart within seconds.

   The pass writes to the DOM through refs rather than React state: it runs
   every frame, and re-rendering three dozen nodes at 60fps to move four pins
   would be wasted work.

   Releasing a flick hands the remaining velocity to a decaying glide, which is
   why this is rAF rather than a transition — the distance is not known when the
   drag ends. Pointer events cover mouse, pen and touch in one path;
   `touch-action: pan-y` in the CSS lets a vertical swipe still scroll. */
const GlobeStage = ({ running = true }) => {
  const [touched, setTouched] = useState(false)
  const stage = useRef(null)
  const landRef = useRef(null)
  const lats = useRef([])
  const mers = useRef([])
  const planes = useRef([])
  const sites = useRef([])
  const pins = useRef([])
  const leads = useRef([])
  const glows = useRef([])
  const pulses = useRef([])
  const flows = useRef({})
  const chips = useRef([])
  const caps = useRef([])

  const turn = useRef(0)
  const vel = useRef(0)
  /* the lean and its own glide, so a vertical flick coasts like a horizontal one */
  const tilt = useRef(TILT_REST)
  const velY = useRef(0)
  const air = useRef(60)
  const held = useRef(false)
  const drag = useRef(null)

  /* the two plane copies are held by the pass, so their refs are its own */
  const nearPlane = useCallback((el) => { planes.current[NEAR] = el }, [])
  const farPlane = useCallback((el) => { planes.current[FAR] = el }, [])

  const paint = useCallback(() => {
    const t = turn.current
    /* One lean drives every part of the graphic. cp/sp are its cosine and
       sine: a point on the sphere is (cos lat sin lon, sin lat, cos lat cos
       lon), and leaning it about the horizontal axis gives the height on
       screen, sin lat * cp - z * sp, and the depth toward the viewer,
       sin lat * sp + z * cp. Everything below is that one rotation. */
    const lean = tilt.current
    const cp = Math.cos(rad(lean))
    const sp = Math.sin(rad(lean))

    /* the land repeats every TILE, so the offset is wrapped into one copy */
    const lx = ((((t / 360) * TILE) % TILE) + TILE) % TILE
    /* The lean rolls the texture as well as turning it. The tile is exactly
       2r tall, so sliding it would bare a band at the limb — the stretch is
       sized to cover exactly what the slide uncovers. */
    const ty = Math.max(-13, Math.min(13, (sp - Math.sin(rad(TILT_REST))) * GLOBE.r * 0.3))
    if (landRef.current) {
      landRef.current.style.transform =
        `translate(${(lx - TILE).toFixed(1)}px, ${ty.toFixed(1)}px) scaleY(${(1 + Math.abs(ty) / GLOBE.r).toFixed(3)})`
    }

    /* Meridians: sampled rather than drawn as ellipses, because a leaned great
       circle projects to an ellipse at an angle. Each is still edge-on when
       its longitude faces the viewer, which is the strongest 3D cue here. */
    MERIDIAN_LONS.forEach((lon, i) => {
      const el = mers.current[i]
      if (!el) return
      const sl = Math.sin(rad(lon + t))
      const cl = Math.cos(rad(lon + t))
      let d = ''
      for (let k = 0; k < RING_STEPS; k += 1) {
        const cf = RING_COS[k]
        const sf = RING_SIN[k]
        const mx = GLOBE.cx + GLOBE.r * cf * sl
        const my = GLOBE.cy - GLOBE.r * (sf * cp - cf * cl * sp)
        d += `${k ? 'L' : 'M'}${mx.toFixed(1)} ${my.toFixed(1)}`
      }
      el.setAttribute('d', `${d}Z`)
    })

    /* Latitudes stay axis-aligned under the lean, so they keep their ellipse:
       they only spread apart and open up as the globe tips toward you. */
    LATS.forEach(({ dy, rx }, i) => {
      const el = lats.current[i]
      if (!el) return
      el.setAttribute('cy', (GLOBE.cy + dy * cp).toFixed(1))
      el.setAttribute('ry', Math.max(0.4, rx * Math.abs(sp)).toFixed(1))
    })

    const lit = CLASSES.map(() => 0)
    const spot = []

    ASSETS.forEach((a, i) => {
      const rel = wrap180(a.lon + t)
      const m = Math.abs(rel)
      const o = m <= FULL ? 1 : m >= GONE ? 0 : (GONE - m) / (GONE - FULL)
      if (o > lit[a.cls]) lit[a.cls] = o

      if (sites.current[i]) sites.current[i].style.opacity = o
      if (chips.current[i]) chips.current[i].style.opacity = o
      if (o <= 0) return

      const cosLat = Math.cos(rad(a.lat))
      const sinLat = Math.sin(rad(a.lat))
      const face = cosLat * Math.cos(rad(rel))
      const x = GLOBE.cx + GLOBE.r * cosLat * Math.sin(rad(rel)) * SPREAD
      /* the lean lifts or drops the site on the face; z is how far it faces
         us, and it drives the size falloff */
      const y = GLOBE.cy - GLOBE.r * (sinLat * cp - face * sp)
      const z = sinLat * sp + face * cp
      const scale = DEPTH + (1 - DEPTH) * Math.max(z, 0)
      spot[i] = [x, y]

      const pin = pins.current[i]
      if (pin) {
        pin.setAttribute(
          'transform',
          `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`
        )
      }
      const d = `M${x.toFixed(1)} ${y.toFixed(1)} ${SLOTS[a.slot].x} ${SLOTS[a.slot].ey}`
      for (const layer of [leads, glows, pulses]) {
        const el = layer.current[i]
        if (el) el.setAttribute('d', d)
      }
    })

    CLASSES.forEach((_, c) => {
      const g = flows.current[c]
      if (g) g.style.opacity = lit[c] * 0.9
      if (!lit[c]) return
      LOOP.forEach((slot, n) => {
        const p = spot[c * PER_CLASS + slot]
        const q = spot[c * PER_CLASS + LOOP[(n + 1) % LOOP.length]]
        if (!p || !q) return
        const d = run(p, q)
        for (const suffix of ['a', 'b', 'c']) {
          const el = flows.current[`${c}.${slot}${suffix}`]
          if (el) el.setAttribute('d', d)
        }
      })
    })
    /* Only ever show one label. Two crossfading labels sit on top of each
       other and read as jumbled text, so instead the caption dips to zero at
       the handover and comes back up with the next class's name. */
    const phase = t / CLASS_ARC
    const near = Math.round(phase)
    const gap = Math.abs(phase - near)
    const show = gap <= 0.3 ? 1 : Math.max(0, (0.5 - gap) / 0.2)
    const front = ((near % CLASSES.length) + CLASSES.length) % CLASSES.length
    caps.current.forEach((el, c) => { if (el) el.style.opacity = c === front ? show : 0 })

    /* The flight. Both copies get the same transform; only one is shown, and
       which one is simply which half of the orbit it is on — the lower half
       passes in front of the globe, the upper half behind it. */
    const ang = rad(air.current + t * PLANE_SPIN)
    const ahead = Math.sin(ang) > 0
    const at = `translate(${(GLOBE.cx + ORBIT.rx * Math.cos(ang)).toFixed(1)} ${(GLOBE.cy + ORBIT.ry * Math.sin(ang)).toFixed(1)}) `
      + `rotate(${((Math.atan2(ORBIT.ry * Math.cos(ang), -ORBIT.rx * Math.sin(ang)) * 180) / Math.PI).toFixed(1)}) `
      + `scale(${(0.92 + 0.42 * (0.5 + 0.5 * Math.sin(ang))).toFixed(3)})`
    planes.current.forEach((el, leg) => {
      if (!el) return
      el.setAttribute('transform', at)
      el.style.opacity = (leg === NEAR) === ahead ? 1 : 0
    })
  }, [])

  /* Placed once on mount even while the loop is parked, so the globe is
     already composed the frame the shell fades in. */
  useEffect(() => { paint() }, [paint])

  /* The intro owns the screen for its first few seconds, and the globe is
     behind it with the shell still transparent. Turning a hundred-odd DOM
     writes a frame loose against the machine's travel is what made the pass
     stutter, so the loop does not start until the gate is actually visible. */
  useEffect(() => {
    if (!running) return undefined
    const calm = reducedMotion()
    let last = performance.now()
    let id = 0
    const frame = (now) => {
      /* clamp the step so a backgrounded tab does not resume with a lurch */
      const dt = Math.min(now - last, 64)
      last = now
      /* the aircraft keeps flying while the globe is held — a plane frozen
         mid-air reads as a broken animation, not a paused one */
      if (!calm) air.current = (air.current + CRUISE * dt) % 360
      if (!held.current) {
        if (!calm) turn.current += DRIFT * dt
        if (vel.current) {
          turn.current += vel.current * dt
          vel.current *= Math.pow(0.9975, dt)
          if (Math.abs(vel.current) < 0.0006) vel.current = 0
        }
        if (velY.current) {
          const next = clampTilt(tilt.current + velY.current * dt)
          /* stop the glide dead at the limit rather than letting it grind */
          if (next === tilt.current) velY.current = 0
          tilt.current = next
          velY.current *= Math.pow(0.9975, dt)
          if (Math.abs(velY.current) < 0.0006) velY.current = 0
        }
      }
      turn.current = ((turn.current % 360) + 360) % 360
      paint()
      id = requestAnimationFrame(frame)
    }
    paint()
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [paint, running])

  const grab = (on) => {
    held.current = on
    stage.current?.classList.toggle('is-held', on)
  }

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    vel.current = 0
    velY.current = 0
    setTouched(true)
    grab(true)
    /* a drag across the full stage is one whole turn across, and a lean from
       one limit to the other down */
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      kx: 360 / e.currentTarget.clientWidth,
      ky: (TILT_MAX - TILT_MIN) / e.currentTarget.clientHeight,
      t: e.timeStamp,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e) => {
    const d = drag.current
    if (!d) return
    const span = Math.max(e.timeStamp - d.t, 1)
    const deg = (e.clientX - d.x) * d.kx
    /* pulling down brings the top of the globe toward you, which is the way
       round that matches grabbing the surface itself */
    const lean = (e.clientY - d.y) * d.ky
    vel.current = deg / span
    velY.current = lean / span
    d.x = e.clientX
    d.y = e.clientY
    d.t = e.timeStamp
    turn.current += deg
    tilt.current = clampTilt(tilt.current + lean)
    paint()
  }

  const up = () => {
    if (!drag.current) return
    drag.current = null
    grab(false)
    vel.current = Math.max(-0.9, Math.min(0.9, vel.current))
    velY.current = Math.max(-0.4, Math.min(0.4, velY.current))
    if (Math.abs(vel.current) < 0.0006) vel.current = 0
    if (Math.abs(velY.current) < 0.0006) velY.current = 0
  }

  const key = (e) => {
    const spin = e.key === 'ArrowLeft' ? -14 : e.key === 'ArrowRight' ? 14 : 0
    const lean = e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0
    if (!spin && !lean) return
    e.preventDefault()
    vel.current = 0
    velY.current = 0
    setTouched(true)
    turn.current += spin
    tilt.current = clampTilt(tilt.current + lean)
    paint()
  }

  return (
    <>
      <div
        className="am-globe__stage" ref={stage}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={key} tabIndex={0} role="group"
        aria-label="Asset globe. Drag it, or use the arrow keys, to turn it left and right, lean it up and down, and bring the next assets into view."
      >
        <AssetGlobe
          landRef={landRef} lats={lats} mers={mers} sites={sites} pins={pins}
          leads={leads} glows={glows} pulses={pulses} flows={flows}
          nearPlane={nearPlane} farPlane={farPlane}
        />
        <AssetChips chips={chips} />
        {!touched && <span className="am-globe__hint" aria-hidden="true">Drag to rotate</span>}
      </div>

      <p className="am-globe__cap" aria-hidden="true">
        {CLASSES.map(({ key, label }, c) => (
          <span className="am-cls" key={key} ref={(el) => { caps.current[c] = el }} style={{ opacity: 0 }}>
            <span className="am-globe__dot" />
            {label}
          </span>
        ))}
      </p>
    </>
  )
}

/* =========================================================================
   The sign-in half's night sky.

   A fixed scatter rather than a random one: every position comes from a hash
   of its index, so the field is identical on every render and every reload —
   a sky that reshuffles when React re-renders reads as a glitch rather than
   as stars. Each mote carries its own size, brightness, cycle and delay, so
   the field breathes unevenly instead of pulsing as one, and a handful of
   larger four-point flares carry the actual sparkle.

   Every delay is negative, which starts each mote partway through its own
   cycle: the sky is already alight on the first painted frame instead of
   spending its first seconds warming up from black.
   ========================================================================= */
const scatter = (n) => {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

const MOTES = Array.from({ length: 92 }, (_, i) => {
  const cycle = 2.6 + scatter(i + 109.5) * 3.8
  return {
    left: (scatter(i + 1) * 100).toFixed(2),
    top: (scatter(i + 31.7) * 100).toFixed(2),
    size: (1.2 + scatter(i + 57.3) * 2.1).toFixed(2),
    peak: (0.5 + scatter(i + 83.1) * 0.5).toFixed(2),
    cycle: cycle.toFixed(2),
    delay: (-scatter(i + 137.9) * cycle).toFixed(2),
    /* a third of them burn deeper gold, so the field is not one flat colour */
    deep: scatter(i + 163.3) > 0.66,
  }
})

/* kept off the very edges, where a flare would sit half outside the panel */
const FLARES = Array.from({ length: 11 }, (_, i) => {
  const cycle = 4.5 + scatter(i + 293.6) * 4
  return {
    left: (7 + scatter(i + 211.4) * 86).toFixed(2),
    top: (6 + scatter(i + 241.8) * 88).toFixed(2),
    size: (9 + scatter(i + 269.2) * 9).toFixed(2),
    cycle: cycle.toFixed(2),
    delay: (-scatter(i + 317.1) * cycle).toFixed(2),
  }
})

const StarField = () => (
  <span className="am-sky" aria-hidden="true">
    {MOTES.map((m, i) => (
      <span
        key={`mote-${i}`}
        className={m.deep ? 'am-mote am-mote--deep' : 'am-mote'}
        style={{
          left: `${m.left}%`, top: `${m.top}%`, width: `${m.size}px`, height: `${m.size}px`,
          '--peak': m.peak, '--cycle': `${m.cycle}s`, '--d': `${m.delay}s`,
        }}
      />
    ))}
    {FLARES.map((f, i) => (
      <span
        key={`flare-${i}`}
        className="am-flare"
        style={{
          left: `${f.left}%`, top: `${f.top}%`, width: `${f.size}px`, height: `${f.size}px`,
          '--cycle': `${f.cycle}s`, '--d': `${f.delay}s`,
        }}
      />
    ))}
  </span>
)

const TILES = [
  { Icon: Boxes, title: 'Asset register', meta: 'Centralized records' },
  { Icon: Wrench, title: 'Maintenance', meta: 'Service visibility' },
  { Icon: ShieldCheck, title: 'Governance', meta: 'Controlled access' },
]

export default function SignIn({ onSubmit, error, configured = true }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showIntro, setShowIntro] = useState(playIntro)
  const [ready, setReady] = useState(() => !playIntro())
  const emailRef = useRef(null)

  const handOff = useCallback(() => {
    setReady(true)
    /* hand the caret to the first field the moment the gate opens */
    setTimeout(() => emailRef.current?.focus(), T.exit)
  }, [])

  useEffect(() => {
    if (!showIntro) return undefined
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showIntro])

  useEffect(() => {
    if (!ready || !showIntro) return undefined
    const t = setTimeout(() => setShowIntro(false), T.exit + 120)
    return () => clearTimeout(t)
  }, [ready, showIntro])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await onSubmit(email.trim(), password)
    } finally {
      setBusy(false)
    }
  }

  const invalid = Boolean(error)

  return (
    <main className="am-auth">
      <style>{styles}</style>

      {showIntro && <Intro onDone={handOff} />}

      <div className={ready ? 'am-shell is-ready' : 'am-shell'}>
        <section className="am-brand" aria-label="Asset Management System overview">
          <span className="am-arc am-arc--right" aria-hidden="true" />
          <span className="am-arc am-arc--corner" aria-hidden="true" />
          <span className="am-brand__hazard" aria-hidden="true" />

          <div className="am-brand__inner">
            <div className="am-rise"><Brand /></div>

            <div className="am-brand__body am-rise">
              <h1 className="am-hero">Know where every asset is—and what it needs next.</h1>
              <p className="am-lede">
                Keep equipment records, repairs, parts, and maintenance activity organized in one secure workspace.
              </p>

              <div className="am-globe">
                <GlobeStage running={ready} />
                <span className="am-sr">
                  Live positions for every class of asset you register — heavy equipment,
                  plant and tools, and IT and office equipment.
                </span>
              </div>

              <div className="am-tiles" aria-label="Workspace capabilities">
                {TILES.map(({ Icon, title, meta }) => (
                  <article className="am-tile" key={title}>
                    <span className="am-tile__icon" aria-hidden="true"><Icon size={15} /></span>
                    <div>
                      <div className="am-tile__title">{title}</div>
                      <div className="am-tile__meta">{meta}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="am-auth__panel" aria-label="Sign in">
          <StarField />

          <form className="am-card" onSubmit={submit} aria-busy={busy}>
            <Brand mobile />
            <span className="am-lock" aria-hidden="true"><LockKeyhole size={18} /></span>
            <h2 className="am-card__title">Welcome back</h2>
            <p className="am-card__note">Sign in with the account provided by your administrator.</p>

            {!configured && (
              <div className="am-alert" role="alert">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.</span>
              </div>
            )}
            {error && (
              <div className="am-alert" id="am-auth-error" role="alert" aria-live="polite">
                <LockKeyhole size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="am-field">
              <label htmlFor="am-auth-email">Email address</label>
              <div className="am-input">
                <Mail size={16} className="am-input__lead" aria-hidden="true" />
                <input
                  id="am-auth-email"
                  ref={emailRef}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="name@company.com"
                  required
                  aria-invalid={invalid}
                  aria-describedby={invalid ? 'am-auth-error' : undefined}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>

            <div className="am-field">
              <label htmlFor="am-auth-password">Password</label>
              <div className="am-input">
                <LockKeyhole size={16} className="am-input__lead" aria-hidden="true" />
                <input
                  id="am-auth-password"
                  className="am-input--pw"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  aria-invalid={invalid}
                  aria-describedby={invalid ? 'am-auth-error' : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="am-reveal"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <button className="am-submit" type="submit" disabled={!configured || busy}>
              {busy && <span className="am-spinner" aria-hidden="true" />}
              <span>{busy ? 'Signing in…' : 'Sign in to workspace'}</span>
            </button>

            <p className="am-assurance">
              <ShieldCheck size={13} aria-hidden="true" /> Your access is protected and role-based.
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}

const styles = `
  .am-auth{
    --gold-hi: var(--ams-yellow-hi);
    --gold-lift: var(--ams-yellow-lift);
    --gold: var(--ams-yellow);
    --gold-deep: var(--ams-yellow-deep);
    --gold-dim: var(--ams-yellow-dim);
    --on-gold: var(--ams-on-yellow);
    --ink: var(--ams-bg);
    --card: var(--ams-surface);
    --line: var(--ams-line);
    --text: var(--ams-text);
    --muted: var(--ams-mute);
    --dim: var(--ams-dim);
    min-height: 100vh;
    background: var(--ink);
    color: var(--text);
    font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .am-auth *{box-sizing:border-box}

  /* the gate stays out of the tab order until the intro hands over */
  .am-shell{
    display:grid;grid-template-columns:50.7% 1fr;min-height:100vh;
    opacity:0;visibility:hidden;transform:translateY(10px);
    transition:opacity .6s ease,transform .6s ease,visibility 0s linear .6s;
  }
  .am-shell.is-ready{opacity:1;visibility:visible;transform:none;transition:opacity .6s ease,transform .6s ease,visibility 0s}

  /* ---------------- left: brand panel ---------------- */
  .am-brand{
    position:relative;overflow:hidden;padding:32px 56px 46px 80px;display:flex;flex-direction:column;
    background:
      radial-gradient(105% 78% at 18% 44%, rgba(255,205,17,.13), transparent 62%),
      radial-gradient(85% 60% at 68% 6%, rgba(255,205,17,.10), transparent 66%),
      radial-gradient(70% 55% at 8% 96%, rgba(255,205,17,.08), transparent 70%),
      var(--ams-rail);
    border-right:1px solid var(--line);
  }
  .am-brand__hazard{position:absolute;inset:0 0 auto 0;height:4px;background:var(--ams-hazard);z-index:2}

  /* Both panes run to the window edges. The shell used to cap at 1536px and
     centre, so anything wider — which is what zooming out gives you — left bare
     ink down both sides, the rail short of the left edge and the hazard tape
     floating mid-screen. Instead the content keeps the width the cap gave it
     and centres inside the pane: 642px is that column, 50.7% of 1536 less this
     panel's padding and divider, so nothing below 1536 moves. */
  .am-brand__inner{flex:1;display:flex;flex-direction:column;width:100%;max-width:642px;margin:0 auto}
  .am-arc{position:absolute;border-radius:50%;border:1px solid rgba(255,205,17,.22);pointer-events:none}
  .am-arc--right{width:412px;height:412px;right:-226px;top:50%;transform:translateY(-50%)}
  .am-arc--right::after{
    content:"";position:absolute;inset:-1px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(255,205,17,.08),transparent 72%);
  }
  .am-arc--corner{width:300px;height:300px;left:-196px;bottom:-128px;border-color:rgba(255,205,17,.18)}
  .am-brand > *:not(.am-arc):not(.am-brand__hazard){position:relative;z-index:1}

  .am-mark{display:flex;align-items:center;gap:9px}
  /* The mark is the AMS emblem itself now. It is gold on a dark globe, so the
     filled gold badge it used to sit in would have swallowed it — the artwork
     carries its own shape and glow instead. */
  .am-mark__badge{width:52px;height:52px;flex:0 0 auto;display:grid;place-items:center}
  .am-mark__badge img{width:100%;height:100%;object-fit:contain;display:block}
  .am-mark__name{font-weight:800;font-size:15.5px;letter-spacing:-.01em;color:var(--gold);line-height:1.2;margin:0}
  .am-mark__sub{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);margin:3px 0 0}
  .am-mark--mobile{display:none;margin-bottom:30px}

  .am-brand__body{margin-top:auto;margin-bottom:auto;max-width:626px;padding-top:26px}
  .am-hero{
    font-size:clamp(28px,2.35vw,36px);line-height:1.14;font-weight:800;letter-spacing:-.022em;margin:0 0 18px;
    max-width:566px;
    background:linear-gradient(96deg,var(--gold-hi) 6%,var(--gold) 52%,var(--gold-deep) 96%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  .am-lede{margin:0;font-size:14.5px;line-height:1.62;color:var(--muted);max-width:486px}

  /* ---- asset globe ----
     The stage owns a fixed 600:340 box, so SVG viewBox units and the HTML
     chips' percentages address one grid. Sizing is a single min() against the
     column, a ceiling, and the viewport height, so the graphic scales
     continuously instead of stepping at breakpoints; the chips then re-size
     themselves against the stage with container units. */
  .am-globe{position:relative;width:min(100%,626px,64vh);margin:clamp(12px,2.4vh,28px) auto 0}
  .am-globe__stage{
    position:relative;width:100%;aspect-ratio:600/400;container-type:inline-size;
    cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;border-radius:14px;
  }
  .am-globe__stage.is-held{cursor:grabbing}
  .am-globe__svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
  .am-globe__hint{
    position:absolute;left:0;right:0;bottom:2%;text-align:center;pointer-events:none;
    font-size:clamp(7px,1.32cqw,9px);font-weight:600;letter-spacing:.24em;text-transform:uppercase;
    color:var(--dim);opacity:.8;animation:am-beat 3s ease-in-out infinite;
  }
  .am-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

  /* The land, the sites and the chips are all positioned by the rAF pass in
     GlobeStage — opacity and transform here would fight it. What stays in CSS
     is everything that does not depend on the rotation. */
  .am-land{fill:url(#am-dots)}
  /* the pass scales the texture about the sphere's centre when the globe is
     leaned, so the transform needs that origin rather than the element's box */
  .am-land__spin{transform-box:view-box;transform-origin:300px 200px}
  /* no opacity transition on the chips or the caption: the pass already writes
     a fresh value every frame, so a transition only lags behind the rotation */

  .am-wire{fill:none;stroke:rgba(255,205,17,.16);stroke-width:.9}
  .am-wire--eq{stroke:rgba(255,205,17,.26);stroke-width:1.1}
  .am-rim{fill:none;stroke:rgba(255,205,17,.42);stroke-width:1.2}

  .am-orbit{fill:none;stroke:rgba(255,205,17,.16);stroke-width:1;stroke-dasharray:2.5 7}

  /* the aircraft on that orbit: lit and solid on the near leg, dimmed on the
     far one so the two copies read as one machine going round the back */
  .am-plane__body{fill:var(--gold-hi);stroke:rgba(10,12,14,.5);stroke-width:.5;stroke-linejoin:round}
  .am-plane__trail{fill:none;stroke:rgba(255,205,17,.42);stroke-width:1.5;stroke-linecap:round;stroke-dasharray:5 4}
  .am-plane--far .am-plane__body{fill:rgba(255,205,17,.4);stroke:none}
  .am-plane--far .am-plane__trail{stroke:rgba(255,205,17,.15)}

  /* pathLength="100" normalises every run, so one keyframe drives them all */
  .am-flow{fill:none;stroke:rgba(255,205,17,.34);stroke-width:1.1;stroke-dasharray:3.5 5}
  .am-flow__halo{
    fill:none;stroke:rgba(255,205,17,.28);stroke-width:9;stroke-linecap:round;
    stroke-dasharray:.9 99.1;animation:am-run 3.6s linear infinite var(--d,0s);
  }
  .am-flow__hot{
    fill:none;stroke:var(--gold-hi);stroke-width:3.6;stroke-linecap:round;
    stroke-dasharray:1.1 98.9;animation:am-run 3.6s linear infinite var(--d,0s);
  }
  @keyframes am-run{to{stroke-dashoffset:-100}}

  .am-lead__glow{fill:none;stroke:rgba(255,205,17,.13);stroke-width:4.5;stroke-linecap:round}
  .am-lead{
    fill:none;stroke:rgba(255,205,17,.4);stroke-width:1;stroke-dasharray:3 4;
    animation:am-march 1.8s linear infinite;
  }
  @keyframes am-march{to{stroke-dashoffset:-14}}
  /* the charge runs from the pin toward the chip, so the tether reads as a
     live link rather than a drawn line */
  .am-lead__pulse{
    fill:none;stroke:var(--gold-hi);stroke-width:3.2;stroke-linecap:round;
    stroke-dasharray:1.6 98.4;animation:am-run 2.6s linear infinite var(--d,0s);
  }

  .am-pin__glow{fill:url(#am-pin-glow)}
  .am-pin__dot{fill:var(--gold)}
  .am-pin__ring{fill:none;stroke:rgba(255,205,17,.45);stroke-width:1}
  .am-pin__ping{
    fill:none;stroke:rgba(255,205,17,.6);stroke-width:1.4;opacity:0;
    transform-box:fill-box;transform-origin:center;
    animation:am-ping 2.8s cubic-bezier(.2,.7,.4,1) infinite var(--d,0s);
  }
  .am-pin__ping--b{animation-delay:calc(var(--d,0s) + 1.4s)}
  @keyframes am-ping{
    0%{transform:scale(.3);opacity:.85}
    70%{opacity:0}
    100%{transform:scale(2.7);opacity:0}
  }

  /* ---- asset chips (HTML, over the SVG) ---- */
  .am-chip{pointer-events:none;
    position:absolute;width:27.5%;transform:translateY(-50%);
    display:flex;align-items:center;gap:1.6cqw;
    padding:1.3cqw 1.7cqw;border-radius:2cqw;
    border:1px solid var(--line);background:var(--ams-surface);
    box-shadow:0 .7cqw 1.8cqw rgba(0,0,0,.5);
  }
  .am-chip__badge{
    flex:0 0 auto;width:5.2cqw;height:5.2cqw;border-radius:1.5cqw;display:grid;place-items:center;
    background:var(--gold);color:var(--on-gold);box-shadow:0 .35cqw 0 var(--gold-dim);
  }
  .am-chip__badge svg{display:block;width:72%;height:72%}
  .am-chip__gl{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .am-chip__txt{min-width:0}
  .am-chip__name{
    display:block;font-size:clamp(8.6px,2.16cqw,12.4px);font-weight:700;color:var(--text);
    line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .am-chip__meta{
    display:block;margin-top:.3cqw;font-size:clamp(6.6px,1.4cqw,8px);font-weight:600;
    letter-spacing:.08em;color:var(--dim);line-height:1.3;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  /* on a narrow stage the site line is below reading size, so it goes */
  @container (max-width:430px){
    .am-chip__meta{display:none}
    .am-chip{padding:1.7cqw}
  }

  .am-globe__cap{position:relative;height:13px;margin:18px 0 0;overflow:hidden}
  .am-globe__dot{
    width:5px;height:5px;border-radius:50%;flex:0 0 auto;background:var(--gold);
    box-shadow:0 0 9px rgba(255,205,17,.8);animation:am-beat 2.4s ease-in-out infinite;
  }
  @keyframes am-beat{0%,100%{opacity:.35}50%{opacity:1}}
  .am-globe__cap .am-cls{
    position:absolute;left:0;right:0;top:0;height:13px;
    display:flex;align-items:center;justify-content:center;gap:9px;line-height:13px;
    font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }

  .am-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:clamp(10px,1.8vh,20px);max-width:626px}
  .am-tile{
    display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;
    border:1px solid var(--line);background:var(--ams-surface);
  }
  .am-tile__icon{
    width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:0 0 auto;
    background:var(--gold);color:var(--on-gold);box-shadow:0 2px 0 var(--gold-dim);
  }
  .am-tile__title{font-size:11.5px;font-weight:700;color:var(--text);margin-bottom:2px;line-height:1.15}
  .am-tile__meta{font-size:9.5px;color:var(--dim);line-height:1.15}

  /* ---------------- right: auth panel ---------------- */
  .am-auth__panel{
    position:relative;padding:40px;display:flex;flex-direction:column;justify-content:center;
    background:
      radial-gradient(60% 45% at 96% 88%, rgba(255,205,17,.09), transparent 68%),
      radial-gradient(55% 40% at 4% 96%, rgba(255,205,17,.07), transparent 70%),
      var(--ink);
  }
  /* The star field sits behind the card: both are positioned, and the card
     comes later in the DOM, so it paints on top without needing a z-index.
     The reduced-motion block at the end of this sheet stills the whole thing,
     which leaves a fixed field rather than an empty one. */
  .am-sky{position:absolute;inset:0;overflow:hidden;pointer-events:none}
  .am-mote{
    position:absolute;border-radius:50%;background:var(--gold-lift);
    box-shadow:0 0 7px rgba(255,205,17,.85),0 0 14px rgba(255,205,17,.35);
    opacity:calc(var(--peak,.7) * .5);
    animation:am-twinkle var(--cycle,4s) ease-in-out infinite var(--d,0s);
  }
  .am-mote--deep{background:var(--gold);box-shadow:0 0 7px rgba(255,205,17,.6)}
  @keyframes am-twinkle{
    0%,100%{opacity:calc(var(--peak,.7) * .42);transform:scale(.78)}
    50%{opacity:var(--peak,.7);transform:scale(1.06)}
  }
  /* four tapered points rather than another dot — this is the bit that reads
     as a sparkle, so it turns slightly as it flares and then gets out of the
     way for most of its cycle */
  .am-flare{
    position:absolute;background:var(--gold-lift);opacity:0;
    clip-path:polygon(50% 0,57% 43%,100% 50%,57% 57%,50% 100%,43% 57%,0 50%,43% 43%);
    filter:drop-shadow(0 0 7px rgba(255,205,17,.95));
    animation:am-sparkle var(--cycle,6s) ease-in-out infinite var(--d,0s);
  }
  @keyframes am-sparkle{
    0%,90%,100%{opacity:0;transform:scale(.3) rotate(0deg)}
    14%{opacity:1;transform:scale(1) rotate(26deg)}
    36%{opacity:.45;transform:scale(.78) rotate(48deg)}
    58%{opacity:.92;transform:scale(.96) rotate(70deg)}
    78%{opacity:.2;transform:scale(.5) rotate(92deg)}
  }

  .am-card{
    position:relative;width:100%;max-width:486px;margin:0 auto;padding:28px 40px 30px;
    border-radius:14px;border:1px solid var(--line);border-top:3px solid var(--gold);
    background:var(--card);box-shadow:0 30px 70px rgba(0,0,0,.6);overflow:hidden;
  }
  .am-card::before{
    content:"";position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(118deg,rgba(255,205,17,.05),rgba(255,205,17,0) 42%);
  }
  .am-card > *{position:relative}

  .am-lock{
    width:38px;height:38px;border-radius:10px;display:grid;place-items:center;
    background:var(--gold);color:var(--on-gold);box-shadow:0 3px 0 var(--gold-dim);
  }
  .am-card__title{font-size:27px;font-weight:800;letter-spacing:-.02em;margin:17px 0 7px;color:var(--gold)}
  .am-card__note{margin:0 0 21px;font-size:12.5px;color:var(--muted)}

  .am-alert{
    display:flex;align-items:flex-start;gap:9px;margin-bottom:17px;padding:11px 13px;border-radius:8px;
    border:1px solid rgba(255,82,71,.4);background:var(--ams-alarm-tint);color:var(--ams-alarm);font-size:12.5px;line-height:1.45;
  }
  .am-alert svg{flex:0 0 auto;margin-top:1px}

  .am-field + .am-field{margin-top:17px}
  .am-field label{
    display:block;font-size:9.5px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;
    color:var(--gold);margin-bottom:8px;
  }
  /* White fields on a dark card. What someone types has to be the most
     legible thing on the screen, so the value is near-black and everything
     around it — icons, placeholder, reveal — steps back into grey. */
  .am-input{
    position:relative;display:flex;align-items:center;background:#fff;border-radius:8px;
    border:1px solid rgba(12,15,20,.2);box-shadow:inset 0 1px 2px rgba(9,11,14,.16);
    transition:border-color .18s ease,box-shadow .18s ease;
  }
  .am-input:focus-within{
    border-color:var(--gold-deep);
    box-shadow:inset 0 1px 2px rgba(9,11,14,.1),0 0 0 3px rgba(255,205,17,.32);
  }
  .am-input__lead{position:absolute;left:14px;color:#79808c}
  .am-input input{
    width:100%;border:0;outline:none;background:transparent;padding:14px 14px 14px 42px;
    font-family:inherit;font-size:13.5px;color:#12161c;caret-color:#12161c;border-radius:8px;
  }
  .am-input input::placeholder{color:#8b93a0}
  /* Chrome paints a remembered login in its own pale blue with its own text
     colour, which would undo both of the above. */
  .am-input input:-webkit-autofill,
  .am-input input:-webkit-autofill:hover,
  .am-input input:-webkit-autofill:focus{
    -webkit-box-shadow:0 0 0 1000px #fff inset;
    -webkit-text-fill-color:#12161c;
    caret-color:#12161c;
  }
  .am-input--pw{padding-right:44px!important}
  .am-reveal{
    position:absolute;right:10px;background:none;border:0;cursor:pointer;padding:6px;
    color:#79808c;display:grid;place-items:center;border-radius:6px;transition:color .18s ease;
  }
  .am-reveal:hover{color:var(--gold-deep)}

  /* Glass rather than a painted slab: a translucent gold pane, a lit rim, and
     a glaze curving across the top the way light sits on glass. The backdrop
     filter picks up what is behind it, which is what stops it reading as a
     flat gradient. */
  .am-submit{
    position:relative;overflow:hidden;isolation:isolate;
    width:100%;margin-top:23px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;
    font-family:inherit;font-size:13.5px;font-weight:800;color:var(--on-gold);
    padding:14px 20px;border-radius:10px;border:1px solid rgba(255,236,150,.5);
    background:linear-gradient(180deg,rgba(255,216,60,.95) 0%,rgba(255,201,12,.8) 46%,rgba(206,155,0,.94) 100%);
    -webkit-backdrop-filter:blur(12px) saturate(150%);
            backdrop-filter:blur(12px) saturate(150%);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.85),
      inset 0 -1px 0 rgba(120,86,0,.4),
      0 10px 26px rgba(255,205,17,.2),
      0 2px 8px rgba(0,0,0,.34);
    transition:box-shadow .18s ease,transform .1s ease,filter .18s ease;
  }
  .am-submit::before{
    content:"";position:absolute;inset:0 0 auto;height:52%;pointer-events:none;
    background:linear-gradient(180deg,rgba(255,255,255,.46),rgba(255,255,255,.08) 62%,rgba(255,255,255,0));
    border-radius:9px 9px 40% 40% / 9px 9px 16px 16px;
  }
  /* The glint: a narrow, angled band of light that travels across the pane and
     then waits off-stage for the rest of the cycle, so it reads as light
     catching glass rather than a strobe. It is clipped by the button's own
     overflow, and sits under the label, which carries z-index 1. */
  .am-submit::after{
    content:"";position:absolute;top:-60%;bottom:-60%;left:0;width:30%;pointer-events:none;
    background:linear-gradient(
      90deg,
      rgba(255,255,255,0),
      rgba(255,255,255,.5) 42%,
      rgba(255,255,255,.92) 52%,
      rgba(255,255,255,.42) 62%,
      rgba(255,255,255,0)
    );
    filter:blur(2px);
    transform:translateX(-220%) rotate(18deg);
    animation:am-glint 4.6s cubic-bezier(.55,.05,.3,1) .9s infinite;
  }
  @keyframes am-glint{
    0%{transform:translateX(-220%) rotate(18deg)}
    /* the pass itself is the first third; the rest of the cycle is the wait,
       spent off the right-hand edge where the jump back is invisible */
    34%,100%{transform:translateX(460%) rotate(18deg)}
  }
  .am-submit:hover:not(:disabled)::after{animation-duration:2.2s;animation-delay:0s}
  .am-submit:disabled::after{animation:none;opacity:0}

  /* the label and spinner ride above the glaze */
  .am-submit > *{position:relative;z-index:1}
  .am-submit:hover:not(:disabled){
    filter:brightness(1.06);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.9),
      inset 0 -1px 0 rgba(120,86,0,.4),
      0 12px 30px rgba(255,205,17,.3),
      0 2px 8px rgba(0,0,0,.34);
  }
  .am-submit:active:not(:disabled){
    transform:translateY(1.5px);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 2px 6px rgba(120,86,0,.35),0 4px 12px rgba(255,205,17,.16);
  }
  .am-submit:disabled{opacity:.55;cursor:not-allowed}
  .am-spinner{
    width:15px;height:15px;border:2px solid rgba(11,13,15,.3);border-top-color:var(--on-gold);
    border-radius:50%;animation:am-spin 700ms linear infinite;
  }
  @keyframes am-spin{to{transform:rotate(360deg)}}

  .am-assurance{display:flex;align-items:center;justify-content:center;gap:7px;margin:18px 0 0;font-size:11px;color:var(--dim)}

  .am-auth :focus-visible{outline:2px solid var(--gold);outline-offset:2px}

  .am-rise{opacity:0;transform:translateY(10px);animation:am-rise .7s cubic-bezier(.22,.8,.3,1) forwards}
  .am-rise + .am-rise{animation-delay:.06s}
  .am-card{animation:am-rise .8s cubic-bezier(.22,.8,.3,1) .1s both}
  @keyframes am-rise{to{opacity:1;transform:none}}

  /* ===================== intro ===================== */
  .am-intro{
    display:grid;place-items:center;position:fixed;inset:0;z-index:60;
    background:
      radial-gradient(72% 58% at 50% 40%, rgba(255,205,17,.10), transparent 68%),
      radial-gradient(52% 42% at 10% 94%, rgba(255,205,17,.07), transparent 72%),
      var(--ams-bg);
    transition:opacity .62s ease, transform .62s ease, filter .62s ease;
  }
  .am-intro.is-out{opacity:0;transform:scale(1.035);filter:blur(4px);pointer-events:none}
  .am-intro__grid{
    position:absolute;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(255,205,17,.05) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,205,17,.05) 1px,transparent 1px);
    background-size:92px 92px;
    -webkit-mask-image:radial-gradient(66% 62% at 50% 44%,#000 28%,transparent 78%);
            mask-image:radial-gradient(66% 62% at 50% 44%,#000 28%,transparent 78%);
  }
  .am-stage{--rigW:clamp(196px,23vw,282px);--rigH:calc(var(--rigW) * .647);position:relative;width:min(1080px,88vw);z-index:1}

  .am-intro__title{
    margin:0;font-weight:800;font-size:clamp(24px,4.55vw,58px);line-height:1;letter-spacing:.005em;
    color:var(--gold);display:flex;flex-wrap:wrap;align-items:flex-end;
    text-shadow:0 0 38px rgba(255,205,17,.18);
  }
  .am-wd{display:inline-flex}
  .am-lw{display:inline-block;overflow:hidden;padding:.06em .012em .1em}
  .am-lt{display:inline-block;transform:translateY(112%);opacity:0;will-change:transform}
  .am-lw.is-on .am-lt{transform:translateY(0);opacity:1;transition:transform .52s cubic-bezier(.19,.9,.24,1), opacity .34s ease}
  .am-sp{display:inline-block;width:.34em}

  .am-band{position:relative;margin-top:clamp(10px,1.4vw,20px);height:calc(var(--rigH) * .909)}
  .am-rule{position:absolute;left:0;right:0;bottom:0;height:1px;background:rgba(255,205,17,.2)}
  /* The line and the machine both ride transforms now, rather than width and
     left: those are layout properties, and animating them re-laid-out the
     rig's whole SVG every frame. A transform stays on the compositor, which
     is what makes the pass across the screen smooth. */
  .am-grade{
    position:absolute;left:0;bottom:0;height:2px;width:100%;transform-origin:left center;
    transform:scaleX(var(--grade-from,0));
    background:linear-gradient(90deg,rgba(255,205,17,0),var(--gold) 55%,var(--gold-hi));
    box-shadow:0 0 16px rgba(255,205,17,.55);
  }
  .am-grade.is-go{animation:am-grade var(--travel-dur,2600ms) cubic-bezier(.65,0,.35,1) var(--travel-delay,420ms) both}
  .am-grade.is-full{transform:scaleX(1)}
  @keyframes am-grade{from{transform:scaleX(var(--grade-from,0))}to{transform:scaleX(var(--grade-to,1))}}

  /* Hidden until the run is armed. The travel's start is measured in JS, and
     until that lands there is no honest place to put the machine — parking it
     at a CSS guess is what used to flash half a digger on screen at refresh,
     before it snapped back off-stage to begin. */
  .am-rig{
    position:absolute;left:0;bottom:calc(var(--rigH) * -.091);width:var(--rigW);
    transform:translate3d(var(--rig-from,-160vw),0,0);opacity:0;
  }
  .am-rig.is-go{
    opacity:1;will-change:transform;
    animation:am-travel var(--travel-dur,2600ms) cubic-bezier(.65,0,.35,1) var(--travel-delay,420ms) both;
  }
  @keyframes am-travel{
    from{transform:translate3d(var(--rig-from),0,0)}
    to{transform:translate3d(var(--rig-to),0,0)}
  }
  .am-rig__glow{
    position:absolute;left:50%;bottom:-14%;width:210%;padding-bottom:150%;transform:translateX(-50%);pointer-events:none;
    background:radial-gradient(closest-side,rgba(255,205,17,.15),transparent 70%);
  }
  .am-exc{position:relative;display:block;width:100%;height:auto;overflow:visible}

  .am-caption{display:flex;align-items:center;gap:11px;margin:18px 0 0;opacity:0;transform:translateY(6px);transition:opacity .5s ease,transform .5s ease}
  .am-intro.is-done .am-caption{opacity:1;transform:none}
  .am-caption__dot{width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px rgba(255,205,17,.8)}
  .am-caption__txt{font-size:clamp(9px,1vw,11px);letter-spacing:.32em;text-transform:uppercase;color:var(--dim)}

  .am-skip{
    position:fixed;right:22px;bottom:20px;z-index:61;background:none;border:0;cursor:pointer;padding:8px 4px;
    font-family:inherit;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;
    color:var(--dim);transition:color .2s ease;
  }
  .am-skip:hover{color:var(--gold)}
  .am-sound{
    position:fixed;left:22px;bottom:20px;z-index:61;display:inline-flex;align-items:center;gap:8px;
    background:none;border:0;cursor:pointer;padding:8px 4px;font-family:inherit;font-size:10.5px;
    font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);transition:color .2s ease;
  }
  .am-sound:hover,.am-sound[aria-pressed="true"]{color:var(--gold)}
  /* autoplay was refused - draw the eye, since one click anywhere fixes it */
  .am-sound.is-blocked{color:var(--gold);animation:am-nudge 1.6s ease-in-out infinite}
  @keyframes am-nudge{0%,100%{opacity:.55}50%{opacity:1}}
  .am-skip kbd{font:inherit;letter-spacing:.08em;margin-left:8px;padding:2px 6px;border:1px solid var(--line);border-radius:4px;color:var(--dim)}

  /* ---- machine motion ---- */
  .am-exc__bounce{transform-box:view-box;transform-origin:150px 192px;animation:am-bob .4s ease-in-out infinite alternate}
  @keyframes am-bob{from{transform:translateY(0) rotate(-.28deg)}to{transform:translateY(-2.2px) rotate(.28deg)}}
  .am-cleats{animation:am-cleats .5s linear infinite}
  @keyframes am-cleats{to{stroke-dashoffset:-32}}
  .am-hub{transform-box:view-box;animation:am-spin2 1.05s linear infinite}
  .am-hub--a{transform-origin:60px 176px}
  .am-hub--b{transform-origin:222px 176px}
  @keyframes am-spin2{to{transform:rotate(360deg)}}
  .am-boom{transform-box:view-box;transform-origin:190px 124px;animation:am-boom 2.9s ease-in-out infinite alternate}
  @keyframes am-boom{from{transform:rotate(-7deg)}to{transform:rotate(3.5deg)}}
  .am-stick{transform-box:view-box;transform-origin:246px 62px;animation:am-stick 2.9s ease-in-out infinite alternate}
  @keyframes am-stick{from{transform:rotate(9deg)}to{transform:rotate(-8deg)}}
  .am-bucket{transform-box:view-box;transform-origin:286px 108px;animation:am-bucket 1.45s ease-in-out infinite alternate}
  @keyframes am-bucket{from{transform:rotate(-15deg)}to{transform:rotate(15deg)}}
  .am-smoke{transform-box:fill-box;transform-origin:center;animation:am-smoke 1.6s ease-out infinite;opacity:0}
  .am-smoke:nth-of-type(2){animation-delay:.53s}
  .am-smoke:nth-of-type(3){animation-delay:1.06s}
  @keyframes am-smoke{
    0%{opacity:0;transform:translate(0,0) scale(.4)}
    18%{opacity:.34}
    100%{opacity:0;transform:translate(-16px,-40px) scale(2.1)}
  }
  .am-dust{transform-box:fill-box;transform-origin:center;animation:am-dust 1.15s ease-out infinite;opacity:0}
  .am-dust:nth-of-type(2){animation-delay:.29s}
  .am-dust:nth-of-type(3){animation-delay:.58s}
  .am-dust:nth-of-type(4){animation-delay:.86s}
  @keyframes am-dust{
    0%{opacity:0;transform:translate(0,0) scale(.3)}
    22%{opacity:.4}
    100%{opacity:0;transform:translate(-42px,-20px) scale(1.7)}
  }

  /* ---------------- responsive ---------------- */
  @media (max-width:1120px){
    .am-brand{padding:30px 34px 40px 44px}
    .am-auth__panel{padding:32px 28px}
    .am-card{padding:28px 30px 30px}
    .am-tiles{gap:11px}
  }
  @media (max-width:900px){
    .am-shell{grid-template-columns:1fr}
    .am-brand{display:none}
    .am-mark--mobile{display:flex}
    .am-auth__panel{min-height:100vh;padding:28px 22px 44px}
    .am-card{padding:26px 22px 28px}
    .am-card__title{font-size:24px}
    .am-stage{--rigW:clamp(150px,42vw,220px);width:90vw}
    .am-intro__title{font-size:clamp(15px,5.3vw,30px)}
    .am-skip{right:14px;bottom:12px}
    .am-skip kbd{display:none}
    .am-sound{left:14px;bottom:12px}
    .am-sound span{display:none}
  }
  @media (max-width:560px){
    .am-auth__panel{align-items:flex-start;padding:18px 14px}
    .am-card{max-width:none;padding:26px 20px 28px;border-radius:12px}
    .am-lock{display:none}
    .am-card__title{font-size:21px}
  }

  /* Short viewports: the globe is already sized against vh, so these only
     tighten the copy around it; below 600px tall it steps aside entirely. */
  @media (max-height:900px){
    .am-brand{padding-top:26px;padding-bottom:34px}
    .am-brand__body{padding-top:12px}
    .am-hero{margin-bottom:13px}
  }
  @media (max-height:790px){
    .am-hero{font-size:clamp(24px,2vw,30px)}
    .am-lede{font-size:13.5px}
    .am-globe__cap{margin-top:7px}
  }
  /* A laptop viewport has to fit a taller globe now, so the frame around it
     gives up its slack before the graphic does. */
  @media (max-height:720px){
    .am-brand{padding-top:20px;padding-bottom:24px}
    .am-globe{margin-top:clamp(6px,1.2vh,14px)}
    .am-globe__cap{margin-top:10px}
    .am-tiles{margin-top:10px}
    .am-auth__panel{padding:26px 32px}
  }
  @media (max-height:640px){
    .am-brand{padding-top:16px;padding-bottom:18px}
    .am-auth__panel{padding:20px 28px}
  }
  @media (max-height:600px){
    .am-globe{display:none}
    .am-tiles{margin-top:26px}
  }

  @media (prefers-reduced-motion:reduce){
    .am-auth *{animation:none!important;transition:none!important}
    .am-rise,.am-card{opacity:1;transform:none}
    .am-shell{opacity:1;visibility:visible;transform:none}
  }
`
