import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const TOPICS = [
  { id: 'url-shortener', name: 'URL Shortener', icon: '🔗', desc: 'Design a system like bit.ly' },
  { id: 'chat-system', name: 'Chat System', icon: '💬', desc: 'Design WhatsApp or Slack' },
  { id: 'news-feed', name: 'News Feed', icon: '📰', desc: 'Design Twitter/X feed' },
  { id: 'video-streaming', name: 'Video Streaming', icon: '🎬', desc: 'Design YouTube or Netflix' },
  { id: 'ride-sharing', name: 'Ride Sharing', icon: '🚗', desc: 'Design Uber or Lyft' },
  { id: 'e-commerce', name: 'E-Commerce', icon: '🛒', desc: 'Design Amazon marketplace' },
  { id: 'search-engine', name: 'Search Engine', icon: '🔍', desc: 'Design Google Search' },
  { id: 'custom', name: 'Custom Topic', icon: '✨', desc: 'Choose your own system' },
]

const PHASES = [
  { name: 'Requirements', short: 'REQ' },
  { name: 'High-Level Design', short: 'HLD' },
  { name: 'Deep Dive', short: 'DEEP' },
  { name: 'Scaling', short: 'SCALE' },
  { name: 'Trade-offs', short: 'TRADE' },
]

function App() {
  // View state: 'landing' | 'interview' | 'report'
  const [view, setView] = useState('landing')
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [sessionActive, setSessionActive] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [aiSpeaking, setAiSpeaking] = useState(false)
  const [error, setError] = useState(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentPhase, setCurrentPhase] = useState(0)

  // Report state
  const [reportData, setReportData] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [savedToHistory, setSavedToHistory] = useState(false)

  // History state
  const [history, setHistory] = useState([])
  const [viewingHistoryReport, setViewingHistoryReport] = useState(null)

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('interview_history')
      if (stored) setHistory(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [])

  const wsRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioQueueRef = useRef([])
  const isPlayingRef = useRef(false)
  const activeAudioSourceRef = useRef(null)
  const pcmProcessorRef = useRef(null)
  const pcmContextRef = useRef(null)
  const streamRef = useRef(null)
  const transcriptEndRef = useRef(null)
  const timerRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const barsRef = useRef(null)

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [transcript])

  // Interview timer
  useEffect(() => {
    if (sessionActive) {
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1)
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [sessionActive])

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Audio visualizer
  const startVisualizer = useCallback((stream) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    analyserRef.current = analyser

    const draw = () => {
      if (!analyserRef.current) return
      animFrameRef.current = requestAnimationFrame(draw)
      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(data)

      if (barsRef.current) {
        const bars = barsRef.current.children
        const count = bars.length
        for (let i = 0; i < count; i++) {
          const idx = Math.floor((i / count) * data.length)
          const val = data[idx] / 255
          const height = Math.max(4, val * 60)
          bars[i].style.height = `${height}px`
        }
      }
    }
    draw()
  }, [])

  const startInterview = async () => {
    if (!selectedTopic) {
      setError('Please select a topic first')
      return
    }

    try {
      setError(null)
      setConnecting(true)
      setView('interview')
      setReportData(null)
      setReportError(null)
      setReportLoading(false)
      setSavedToHistory(false)
      console.log("[1] Requesting ephemeral token from backend...")

      const res = await fetch('http://localhost:8000/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: selectedTopic.name })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Backend returned ${res.status}`)
      }

      const data = await res.json()
      const token = data.ephemeral_token
      console.log("[2] Got ephemeral token:", token.substring(0, 30) + "...")

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
      }

      console.log("[3] Requesting microphone access...")
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 }
      })
      console.log("[4] Microphone access granted")

      // Start visualizer
      startVisualizer(streamRef.current)

      const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`
      console.log("[5] Connecting WebSocket...")
      wsRef.current = new WebSocket(WS_URL)

      wsRef.current.onopen = () => {
        console.log("[6] WebSocket OPEN — sending setup message")
        const setupMessage = {
          setup: { model: "models/gemini-3.1-flash-live-preview" }
        }
        wsRef.current.send(JSON.stringify(setupMessage))
        console.log("[7] Setup message sent")
        setSessionActive(true)
        setConnecting(false)
        setElapsedTime(0)
        startPcmCapture(streamRef.current)
      }

      wsRef.current.onmessage = async (event) => {
        let response
        try {
          if (event.data instanceof Blob) {
            response = JSON.parse(await event.data.text())
          } else {
            response = JSON.parse(event.data)
          }
        } catch (e) {
          console.error("[WS] Parse error:", e)
          return
        }

        console.log("[WS] Message:", JSON.stringify(response).substring(0, 200))

        if (response.setupComplete) {
          console.log("[WS] ✅ Setup complete!")
          return
        }

        if (response.serverContent) {
          const sc = response.serverContent

          if (sc.inputTranscription && sc.inputTranscription.text) {
            setTranscript(prev => {
              const last = prev[prev.length - 1]
              if (last && last.speaker === 'You' && !last.complete) {
                const updated = [...prev]
                updated[updated.length - 1] = { ...last, text: last.text + sc.inputTranscription.text }
                return updated
              }
              return [...prev, { speaker: 'You', text: sc.inputTranscription.text, time: new Date(), complete: false }]
            })
          }
          if (sc.outputTranscription && sc.outputTranscription.text) {
            setTranscript(prev => {
              const last = prev[prev.length - 1]
              if (last && last.speaker === 'AI' && !last.complete) {
                const updated = [...prev]
                updated[updated.length - 1] = { ...last, text: last.text + sc.outputTranscription.text }
                return updated
              }
              return [...prev, { speaker: 'AI', text: sc.outputTranscription.text, time: new Date(), complete: false }]
            })
          }

          if (sc.modelTurn && sc.modelTurn.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData) {
                queueAudio(part.inlineData.data)
              }
            }
          }

          if (sc.turnComplete) {
            setTranscript(prev => {
              if (prev.length === 0) return prev
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], complete: true }
              return updated
            })
          }

          if (sc.interrupted) {
            audioQueueRef.current = []
            setAiSpeaking(false)
          }
        }
      }

      wsRef.current.onerror = (e) => {
        console.error("[WS] Error:", e)
        setError("WebSocket connection error. Check console.")
        setConnecting(false)
      }

      wsRef.current.onclose = (e) => {
        console.log(`[WS] Closed: code=${e.code}, reason=${e.reason}`)
        cleanupSession()
        if (e.code !== 1000) {
          setError(`Connection closed (code: ${e.code}). Try restarting.`)
        }
      }

    } catch (err) {
      console.error("[ERROR]", err)
      setError(err.message)
      setConnecting(false)
      cleanupSession()
    }
  }

  const cleanupSession = () => {
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect()
      pcmProcessorRef.current = null
    }
    if (pcmContextRef.current) {
      pcmContextRef.current.close()
      pcmContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    audioQueueRef.current = []
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop()
      } catch (e) {
        // Source might have already stopped
      }
      activeAudioSourceRef.current = null
    }
    isPlayingRef.current = false
    setAiSpeaking(false)
    analyserRef.current = null
    setSessionActive(false)
    setConnecting(false)
  }

  const startPcmCapture = (stream) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
    pcmContextRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    pcmProcessorRef.current = processor
    source.connect(processor)
    processor.connect(audioCtx.destination)
    console.log("[MIC] PCM capture started")

    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      const inputData = e.inputBuffer.getChannelData(0)
      const pcmData = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        let s = Math.max(-1, Math.min(1, inputData[i]))
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      const uint8Array = new Uint8Array(pcmData.buffer)
      const base64Audio = window.btoa(String.fromCharCode.apply(null, uint8Array))
      wsRef.current.send(JSON.stringify({
        realtimeInput: {
          audio: { data: base64Audio, mimeType: "audio/pcm;rate=16000" }
        }
      }))
    }
  }

  const queueAudio = (base64String) => {
    const binaryString = window.atob(base64String)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const int16Array = new Int16Array(bytes.buffer)
    const float32Array = new Float32Array(int16Array.length)
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0
    }
    const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, 24000)
    audioBuffer.getChannelData(0).set(float32Array)
    audioQueueRef.current.push(audioBuffer)
    playNextAudio()
  }

  const playNextAudio = () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return
    isPlayingRef.current = true
    setAiSpeaking(true)
    const audioBuffer = audioQueueRef.current.shift()
    const source = audioContextRef.current.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContextRef.current.destination)
    activeAudioSourceRef.current = source
    source.onended = () => {
      if (activeAudioSourceRef.current === source) {
        activeAudioSourceRef.current = null
      }
      isPlayingRef.current = false
      if (audioQueueRef.current.length === 0) setAiSpeaking(false)
      playNextAudio()
    }
    source.start()
  }

  const endInterview = async () => {
    const finalElapsed = elapsedTime
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "User ended interview")
    }
    cleanupSession()
    if (timerRef.current) clearInterval(timerRef.current)

    // Build transcript string
    const transcriptText = transcript
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n')

    // Switch to report view with loading
    setView('report')
    setReportLoading(true)
    setReportError(null)
    setReportData(null)
    setSavedToHistory(false)

    try {
      const res = await fetch('http://localhost:8000/api/session/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcriptText,
          topic: selectedTopic?.name || 'Unknown',
          duration_seconds: finalElapsed
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Evaluation failed (${res.status})`)
      }

      const data = await res.json()
      setReportData(data)
    } catch (err) {
      console.error('[EVAL ERROR]', err)
      setReportError(err.message)
    } finally {
      setReportLoading(false)
    }
  }

  const backToLanding = () => {
    if (sessionActive) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, "User ended interview")
      }
      cleanupSession()
      if (timerRef.current) clearInterval(timerRef.current)
    }
    setView('landing')
    setTranscript([])
    setElapsedTime(0)
    setError(null)
    setCurrentPhase(0)
    setReportData(null)
    setReportError(null)
    setReportLoading(false)
    setSavedToHistory(false)
    setViewingHistoryReport(null)
  }

  const saveToHistory = () => {
    if (!reportData || savedToHistory) return
    const entry = {
      id: Date.now().toString(),
      topic: selectedTopic ? { id: selectedTopic.id, name: selectedTopic.name, icon: selectedTopic.icon } : { id: 'unknown', name: 'Unknown', icon: '❓' },
      date: new Date().toISOString(),
      duration: elapsedTime,
      overall_score: reportData.overall_score,
      scores: reportData.scores,
      strengths: reportData.strengths,
      improvements: reportData.improvements,
      summary: reportData.summary,
      hire_recommendation: reportData.hire_recommendation
    }
    const updated = [entry, ...history]
    setHistory(updated)
    localStorage.setItem('interview_history', JSON.stringify(updated))
    setSavedToHistory(true)
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('interview_history')
  }

  const getScoreColor = (score) => {
    if (score >= 8) return 'var(--accent-emerald)'
    if (score >= 6) return 'var(--accent-blue)'
    if (score >= 4) return 'var(--accent-purple)'
    return 'var(--accent-rose)'
  }

  const getHireBadgeClass = (rec) => {
    if (!rec) return ''
    const lower = rec.toLowerCase()
    if (lower.includes('strong hire')) return 'hire-strong'
    if (lower.includes('lean hire') || lower.includes('hire')) return 'hire-lean'
    return 'hire-no'
  }

  // ─── RENDER ────────────────────────────────────────────────

  // ─── REPORT VIEW (including history report) ────────────────
  const renderReport = (data, isHistoryView = false) => {
    const scorePercent = ((data.overall_score || 0) / 10) * 100
    const scoreColor = getScoreColor(data.overall_score || 0)
    const scoreCategories = [
      { label: 'Requirements', key: 'requirements_gathering' },
      { label: 'High-Level Design', key: 'high_level_design' },
      { label: 'Deep Dive', key: 'deep_dive' },
      { label: 'Scalability', key: 'scalability' },
      { label: 'Trade-offs', key: 'trade_offs' },
      { label: 'Communication', key: 'communication' },
    ]
    return (
      <div className="report-content">
        {/* Score Circle */}
        <div className="report-score-section">
          <div
            className="score-circle"
            style={{
              background: `conic-gradient(${scoreColor} ${scorePercent}%, rgba(255,255,255,0.06) ${scorePercent}%)`
            }}
          >
            <div className="score-circle-inner">
              <span className="score-value">{data.overall_score ?? '–'}</span>
              <span className="score-max">/10</span>
            </div>
          </div>
          <div className={`hire-badge ${getHireBadgeClass(data.hire_recommendation)}`}>
            {data.hire_recommendation || 'N/A'}
          </div>
        </div>

        {/* Individual Score Bars */}
        <div className="report-scores-panel">
          <h3 className="report-panel-title">Skill Breakdown</h3>
          {scoreCategories.map(cat => {
            const val = data.scores?.[cat.key] ?? 0
            return (
              <div key={cat.key} className="score-bar-row">
                <span className="score-bar-label">{cat.label}</span>
                <div className="score-bar-track">
                  <div
                    className="score-bar-fill"
                    style={{ width: `${(val / 10) * 100}%` }}
                  />
                </div>
                <span className="score-bar-value">{val}</span>
              </div>
            )
          })}
        </div>

        {/* Strengths & Improvements */}
        <div className="report-feedback-grid">
          <div className="report-feedback-panel strengths">
            <h3 className="report-panel-title">Strengths</h3>
            <ul className="feedback-list">
              {(data.strengths || []).map((s, i) => (
                <li key={i}><span className="feedback-icon">✅</span>{s}</li>
              ))}
            </ul>
          </div>
          <div className="report-feedback-panel improvements">
            <h3 className="report-panel-title">Areas to Improve</h3>
            <ul className="feedback-list">
              {(data.improvements || []).map((s, i) => (
                <li key={i}><span className="feedback-icon">💡</span>{s}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Summary */}
        {data.summary && (
          <div className="report-summary-panel">
            <h3 className="report-panel-title">Summary</h3>
            <p className="report-summary-text">{data.summary}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="report-meta-panel">
          <div className="report-meta-item">
            <span className="meta-label">Topic</span>
            <span className="meta-value">{isHistoryView ? (data._topicName || 'N/A') : (selectedTopic?.name || 'N/A')}</span>
          </div>
          <div className="report-meta-item">
            <span className="meta-label">Duration</span>
            <span className="meta-value">{formatTime(isHistoryView ? (data._duration || 0) : elapsedTime)}</span>
          </div>
          <div className="report-meta-item">
            <span className="meta-label">Date</span>
            <span className="meta-value">{isHistoryView ? new Date(data._date).toLocaleDateString() : new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    )
  }

  // ─── HISTORY REPORT VIEW ────────────────────────────────────
  if (viewingHistoryReport) {
    const hr = viewingHistoryReport
    const reportLike = {
      overall_score: hr.overall_score,
      scores: hr.scores,
      strengths: hr.strengths,
      improvements: hr.improvements,
      summary: hr.summary,
      hire_recommendation: hr.hire_recommendation,
      _topicName: hr.topic?.name,
      _duration: hr.duration,
      _date: hr.date
    }
    return (
      <div className="app-container report-view">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />

        <header className="report-header">
          <h1 className="report-title">
            <span className="report-topic-icon">{hr.topic?.icon || '📋'}</span>
            {hr.topic?.name || 'Interview'} — Past Report
          </h1>
        </header>

        {renderReport(reportLike, true)}

        <div className="report-actions">
          <button className="btn-start" onClick={() => setViewingHistoryReport(null)}>
            ← Back to Home
          </button>
        </div>
      </div>
    )
  }

  // ─── REPORT VIEW (current) ─────────────────────────────────
  if (view === 'report') {
    return (
      <div className="app-container report-view">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />

        <header className="report-header">
          <h1 className="report-title">
            <span className="report-topic-icon">{selectedTopic?.icon || '📋'}</span>
            Evaluation Report
          </h1>
        </header>

        {reportLoading && (
          <div className="report-loading">
            <div className="report-spinner" />
            <p>Generating your evaluation report...</p>
          </div>
        )}

        {reportError && (
          <div className="report-error">
            <div className="error-banner">{reportError}</div>
            <button className="btn-start" onClick={backToLanding} style={{ marginTop: '1.5rem' }}>
              ← Back to Home
            </button>
          </div>
        )}

        {reportData && (
          <>
            {renderReport(reportData)}

            <div className="report-actions">
              <button className="btn-start" onClick={backToLanding}>
                New Interview
              </button>
              <button
                className={`btn-save-history ${savedToHistory ? 'saved' : ''}`}
                onClick={saveToHistory}
                disabled={savedToHistory}
              >
                {savedToHistory ? '✓ Saved to History' : 'Save to History'}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── LANDING VIEW ──────────────────────────────────────────
  if (view === 'landing') {
    return (
      <div className="app-container landing-view">
        {/* Animated background orbs */}
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />

        <header className="landing-header">
          <div className="logo-mark">
            <span className="logo-icon">◆</span>
          </div>
          <h1>System Design<br /><span className="gradient-text">Interviewer</span></h1>
          <p className="subtitle">Practice with an AI interviewer that adapts to your level.<br />Real-time voice conversation powered by Gemini.</p>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="topic-section">
          <h2 className="section-title">Choose a Topic</h2>
          <div className="topic-grid">
            {TOPICS.map(topic => (
              <button
                key={topic.id}
                className={`topic-card ${selectedTopic?.id === topic.id ? 'selected' : ''}`}
                onClick={() => setSelectedTopic(topic)}
              >
                <span className="topic-icon">{topic.icon}</span>
                <span className="topic-name">{topic.name}</span>
                <span className="topic-desc">{topic.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Session History */}
        {history.length > 0 && (
          <section className="history-section">
            <div className="history-header">
              <h2 className="section-title" style={{ textAlign: 'left', marginBottom: 0 }}>Past Interviews</h2>
              <button className="btn-clear-history" onClick={clearHistory}>Clear History</button>
            </div>
            <div className="history-grid">
              {history.map(entry => (
                <button
                  key={entry.id}
                  className="history-card"
                  onClick={() => setViewingHistoryReport(entry)}
                >
                  <span className="history-card-icon">{entry.topic?.icon || '📋'}</span>
                  <div className="history-card-info">
                    <span className="history-card-topic">{entry.topic?.name || 'Unknown'}</span>
                    <span className="history-card-date">{new Date(entry.date).toLocaleDateString()}</span>
                  </div>
                  <div className="history-card-score">{entry.overall_score}<span>/10</span></div>
                  <div className={`history-card-badge ${getHireBadgeClass(entry.hire_recommendation)}`}>
                    {entry.hire_recommendation || '–'}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="landing-actions">
          <button
            className="btn-start"
            disabled={!selectedTopic}
            onClick={startInterview}
          >
            <span className="btn-start-icon">▶</span>
            Start Interview
          </button>
          {selectedTopic && (
            <p className="selected-label">Selected: <strong>{selectedTopic.name}</strong></p>
          )}
        </div>

        <footer className="landing-footer">
          <p>Built with Gemini Live API · Real-time WebSocket Streaming</p>
        </footer>
      </div>
    )
  }

  // ─── INTERVIEW VIEW ────────────────────────────────────────

  return (
    <div className="app-container interview-view">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      {/* Top bar */}
      <div className="interview-topbar">
        <button className="btn-back" onClick={backToLanding}>
          ← Back
        </button>
        <div className="topbar-center">
          <div className={`live-badge ${sessionActive ? 'active' : ''}`}>
            <span className="live-dot" />
            {sessionActive ? 'LIVE' : connecting ? 'CONNECTING' : 'OFFLINE'}
          </div>
          {sessionActive && (
            <span className="timer">{formatTime(elapsedTime)}</span>
          )}
        </div>
        <div className="topbar-topic">
          {selectedTopic?.icon} {selectedTopic?.name}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Phase progress */}
      {sessionActive && (
        <div className="phase-bar">
          {PHASES.map((phase, idx) => (
            <div key={idx} className={`phase-step ${idx <= currentPhase ? 'active' : ''} ${idx === currentPhase ? 'current' : ''}`}>
              <div className="phase-dot" />
              <span className="phase-label">{phase.short}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main interview area */}
      <div className="interview-body">
        {/* AI Orb */}
        <div className="orb-section">
          <div className={`ai-orb ${aiSpeaking ? 'speaking' : sessionActive ? 'listening' : 'idle'}`}>
            <div className="orb-ring ring-1" />
            <div className="orb-ring ring-2" />
            <div className="orb-ring ring-3" />
            <div className="orb-core">
              <span className="orb-icon">◆</span>
            </div>
          </div>
          <p className="orb-status">
            {connecting ? 'Connecting...' : aiSpeaking ? 'AI is speaking' : sessionActive ? 'Listening to you...' : 'Ready'}
          </p>

          {/* Audio Bars Visualizer */}
          {sessionActive && (
            <div className="audio-bars" ref={barsRef}>
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="audio-bar" />
              ))}
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="transcript-panel">
          <div className="transcript-header">
            <h3>Transcript</h3>
          </div>
          <div className="transcript-container">
            {transcript.length === 0 && (
              <div className="transcript-empty">
                <span className="empty-icon">🎙️</span>
                <p>Start speaking to begin the interview...</p>
              </div>
            )}
            {transcript.map((t, idx) => (
              <div key={idx} className={`chat-bubble ${t.speaker === 'You' ? 'user' : 'ai'}`}>
                <div className="bubble-avatar">
                  {t.speaker === 'You' ? '👤' : '◆'}
                </div>
                <div className="bubble-content">
                  <span className="bubble-name">{t.speaker}</span>
                  <p className="bubble-text">{t.text}</p>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="interview-controls">
        {!sessionActive && !connecting ? (
          <button className="btn-start" onClick={startInterview}>
            <span className="btn-start-icon">▶</span> Reconnect
          </button>
        ) : (
          <button className="btn-end" onClick={endInterview} disabled={connecting}>
            <span className="btn-end-icon">■</span> End Interview
          </button>
        )}
      </div>
    </div>
  )
}

export default App
