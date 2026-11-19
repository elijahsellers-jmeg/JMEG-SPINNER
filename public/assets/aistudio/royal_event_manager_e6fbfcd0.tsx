import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, collection, onSnapshot, query } from 'firebase/firestore';
import { Ticket, UserCheck, Dices, Crown, Sparkles, QrCode, Search, CheckCircle2 } from 'lucide-react';

// ==========================================
// 1. FIREBASE INITIALIZATION (Strict Rules)
// ==========================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'royal-event-app';

// ==========================================
// 2. HELPER FUNCTIONS & EFFECTS
// ==========================================

// Web Audio API Synthesizer for a Royal Trumpet Fanfare
// Guarantees sound without relying on external audio files that could 404
const playRoyalFanfare = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    
    const playNote = (freq, startTime, duration, type = 'sawtooth') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = type;
      osc.frequency.value = freq;

      // Filter makes it sound more "brassy"
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, startTime);
      filter.frequency.exponentialRampToValueAtTime(3000, startTime + 0.1);

      // Envelope for punchy attack and smooth release
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.6, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // C Major Arpeggio Fanfare (C4, E4, G4, C5)
    playNote(261.63, now, 0.3);       
    playNote(329.63, now + 0.3, 0.3); 
    playNote(392.00, now + 0.6, 0.3); 
    playNote(523.25, now + 0.9, 1.5); 
  } catch (e) {
    console.error("Audio playback failed", e);
  }
};

// Vibrant colors for the Spinner Wheel
const WHEEL_COLORS = [
  '#FF3366', '#20A4F3', '#FFB100', '#2EC4B6', 
  '#8338EC', '#FF9F1C', '#E71D36', '#41EAD4'
];

// ==========================================
// 3. MAIN APPLICATION COMPONENT
// ==========================================
export default function App() {
  const [user, setUser] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [currentTab, setCurrentTab] = useState('rsvp');
  
  // Auth Effect (Must run first)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Authentication failed:", e);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching Effect (Guarded by user)
  useEffect(() => {
    if (!user) return;

    const attendeesRef = collection(db, 'artifacts', appId, 'public', 'data', 'attendees');
    const q = query(attendeesRef); // Fetch all, we filter/sort in memory per RULE 2

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort by timestamp for consistent ordering
      list.sort((a, b) => a.timestamp - b.timestamp);
      setAttendees(list);
    }, (error) => {
      console.error("Firestore snapshot error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Inject Confetti library dynamically for absolute reliability
  useEffect(() => {
    if (!window.confetti) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // Filter lists based on status
  const registeredAttendees = attendees.filter(a => a.status === 'registered');
  const checkedInAttendees = attendees.filter(a => a.status === 'checked-in');

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans relative overflow-hidden flex flex-col">
      {/* Dynamic styles for the reveal animation */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes royal-flash {
          0%, 100% { background-color: #0f172a; } /* slate-900 */
          25% { background-color: #4c1d95; } /* purple-900 */
          75% { background-color: #854d0e; } /* gold/yellow-800 */
        }
        .animate-royal-flash {
          animation: royal-flash 0.8s infinite;
        }
        @keyframes crown-fall {
          0% { transform: translateY(-10vh) rotate(0deg) scale(0.5); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg) scale(1.5); opacity: 0; }
        }
        .crown-emoji {
          position: fixed;
          font-size: 3rem;
          animation: crown-fall 3s linear forwards;
          z-index: 50;
          pointer-events: none;
        }
      `}} />

      {/* Navigation Header */}
      <header className="bg-slate-800 border-b border-slate-700 shadow-md p-4 relative z-20">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-2 justify-center sm:justify-between items-center">
          <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-200 flex items-center gap-2">
            <Crown size={28} className="text-yellow-400" />
            Royal Event
          </h1>
          <nav className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
            <button 
              onClick={() => setCurrentTab('rsvp')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${currentTab === 'rsvp' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <Ticket size={18} /> <span className="hidden sm:inline">RSVP</span>
            </button>
            <button 
              onClick={() => setCurrentTab('checkin')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${currentTab === 'checkin' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <UserCheck size={18} /> <span className="hidden sm:inline">Check-In</span>
            </button>
            <button 
              onClick={() => setCurrentTab('spinner')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${currentTab === 'spinner' ? 'bg-yellow-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <Dices size={18} /> <span className="hidden sm:inline">Spinner</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-10 flex flex-col items-center">
        {!user ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-50">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p>Connecting to Royal Registry...</p>
          </div>
        ) : (
          <div className="w-full max-w-4xl mx-auto">
            {currentTab === 'rsvp' && <RSVPView attendees={attendees} />}
            {currentTab === 'checkin' && <CheckInView attendees={attendees} />}
            {currentTab === 'spinner' && <SpinnerView checkedInUsers={checkedInAttendees} />}
          </div>
        )}
      </main>
    </div>
  );
}

// ==========================================
// 4. SUB-VIEWS
// ==========================================

function RSVPView({ attendees }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [myTicketId, setMyTicketId] = useState(null);

  const handleRSVP = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    try {
      const newId = crypto.randomUUID();
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'attendees', newId);
      
      await setDoc(docRef, {
        name: name.trim(),
        status: 'registered',
        timestamp: Date.now()
      });
      
      setMyTicketId(newId);
    } catch (err) {
      console.error("Error creating RSVP:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setMyTicketId(null);
  };

  if (myTicketId) {
    const myTicket = attendees.find(a => a.id === myTicketId);
    // Use an incredibly reliable API for QR codes to avoid bundle dependency failures
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(myTicketId)}&color=1e1b4b&bgcolor=ffffff`;

    return (
      <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700 max-w-md mx-auto text-center animate-in fade-in zoom-in duration-300">
        <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-2xl font-bold mb-2">You're on the list!</h2>
        <p className="text-slate-400 mb-6">Welcome, {myTicket?.name || 'Guest'}. Save this QR code for fast check-in at the entrance.</p>
        
        <div className="bg-white p-4 rounded-xl inline-block shadow-inner mb-6 border-4 border-slate-200">
          <img src={qrUrl} alt="Your Ticket QR Code" className="w-48 h-48 mx-auto" />
        </div>
        
        <div className="text-xs text-slate-500 break-all mb-6">ID: {myTicketId}</div>
        
        <button 
          onClick={resetForm}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
        >
          Register another guest
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 sm:p-10 shadow-2xl border border-slate-700 max-w-md mx-auto">
      <div className="flex justify-center mb-6">
        <Ticket size={48} className="text-indigo-500" />
      </div>
      <h2 className="text-2xl font-bold text-center mb-2">Event RSVP</h2>
      <p className="text-slate-400 text-center mb-8">Enter your name to join the registry and receive your entrance pass.</p>
      
      <form onSubmit={handleRSVP} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Full Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            placeholder="e.g. John Doe"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg shadow-lg transform transition hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? 'Registering...' : 'Get My Ticket'}
        </button>
      </form>
    </div>
  );
}

function CheckInView({ attendees }) {
  const [scanInput, setScanInput] = useState('');
  const [message, setMessage] = useState(null);

  const registeredUsers = attendees.filter(a => a.status === 'registered');
  const checkedInUsers = attendees.filter(a => a.status === 'checked-in');

  const checkInUser = async (userId) => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'attendees', userId);
      await updateDoc(docRef, { status: 'checked-in' });
      setMessage({ type: 'success', text: 'Checked in successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error("Error checking in:", err);
      setMessage({ type: 'error', text: 'Failed to check in.' });
    }
  };

  const handleScanSubmit = (e) => {
    e.preventDefault();
    const id = scanInput.trim();
    if (!id) return;
    
    const user = attendees.find(a => a.id === id);
    if (!user) {
      setMessage({ type: 'error', text: 'Invalid QR Code / ID not found.' });
    } else if (user.status === 'checked-in') {
      setMessage({ type: 'error', text: `${user.name} is already checked in.` });
    } else {
      checkInUser(id);
    }
    setScanInput('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
      {/* Scanner Simulator */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-xl border border-slate-700 flex flex-col h-[500px]">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <QrCode className="text-indigo-400" />
          Scan Check-In
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Use a hardware scanner (which acts as a keyboard) or manually enter a Ticket ID to check someone in.
        </p>

        <form onSubmit={handleScanSubmit} className="mb-6 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={18} className="text-slate-500" />
          </div>
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="Scan QR or enter ID..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-sm"
          />
        </form>

        {message && (
          <div className={`p-4 rounded-lg mb-4 text-sm font-medium ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
            {message.text}
          </div>
        )}

        <div className="flex-1 bg-slate-900 rounded-lg border border-slate-700 p-4 overflow-y-auto">
           <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Recently Checked In</h3>
           {checkedInUsers.length === 0 ? (
             <p className="text-slate-500 text-sm italic">No one has checked in yet.</p>
           ) : (
             <ul className="space-y-2">
               {checkedInUsers.slice().reverse().map(u => (
                 <li key={u.id} className="flex justify-between items-center bg-slate-800 px-3 py-2 rounded border border-slate-700">
                   <span className="font-medium">{u.name}</span>
                   <CheckCircle2 size={16} className="text-green-500" />
                 </li>
               ))}
             </ul>
           )}
        </div>
      </div>

      {/* Manual Fallback List */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-xl border border-slate-700 flex flex-col h-[500px]">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <UserCheck className="text-indigo-400" />
          Manual Roster
        </h2>
        <div className="flex justify-between items-end mb-4 border-b border-slate-700 pb-2">
          <span className="text-sm text-slate-400">Waiting for check-in:</span>
          <span className="bg-slate-900 text-indigo-400 px-2 py-1 rounded text-xs font-bold">{registeredUsers.length}</span>
        </div>
        
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {registeredUsers.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Ticket size={32} className="mb-2 opacity-50" />
               <p>All registered guests are checked in.</p>
             </div>
          ) : (
            <ul className="space-y-3">
              {registeredUsers.map(u => (
                <li key={u.id} className="flex justify-between items-center bg-slate-900 p-3 rounded-lg border border-slate-700 hover:border-indigo-500/50 transition-colors group">
                  <div>
                    <div className="font-bold text-slate-200">{u.name}</div>
                    <div className="text-xs text-slate-500 font-mono truncate w-32">{u.id}</div>
                  </div>
                  <button 
                    onClick={() => checkInUser(u.id)}
                    className="bg-slate-800 hover:bg-indigo-600 text-indigo-400 hover:text-white border border-indigo-500/30 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                  >
                    Check In
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SpinnerView({ checkedInUsers }) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState(null);
  const [crowns, setCrowns] = useState([]);
  
  const numSegments = checkedInUsers.length;
  const sliceAngle = numSegments > 0 ? 360 / numSegments : 0;

  // Generate Conic Gradient for the Wheel Background
  const wheelGradient = numSegments > 0 
    ? checkedInUsers.map((_, i) => `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`).join(', ')
    : 'gray 0deg 360deg';

  const triggerExtravaganza = () => {
    // 1. Play Royal Trumpet
    playRoyalFanfare();

    // 2. Add full screen body flash via manipulating global state
    document.body.classList.add('animate-royal-flash');
    setTimeout(() => document.body.classList.remove('animate-royal-flash'), 4000);

    // 3. Fire high-density Confetti
    if (window.confetti) {
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        window.confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#FFD700', '#800080'] // Gold and Purple
        });
        window.confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#FFD700', '#800080']
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }

    // 4. Generate falling crowns
    const newCrowns = Array.from({ length: 20 }).map((_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100 + 'vw',
      delay: Math.random() * 1 + 's',
      duration: Math.random() * 2 + 2 + 's'
    }));
    setCrowns(newCrowns);
    
    // Clean up crowns after animation
    setTimeout(() => setCrowns([]), 5000);
  };

  const handleSpin = () => {
    if (numSegments < 2 || isSpinning) return;
    
    // Clear previous winner
    setWinner(null);
    setIsSpinning(true);
    
    // Pick a random winner
    const winnerIndex = Math.floor(Math.random() * numSegments);
    
    // Mathematics of landing on the winner:
    // Conic gradient starts at 12 o'clock (0deg). 
    // The center of the winning slice is `winnerIndex * sliceAngle + sliceAngle / 2`.
    // To bring that center to 12 o'clock, we must rotate the wheel backwards by that amount.
    const centerOfWinner = (winnerIndex * sliceAngle) + (sliceAngle / 2);
    const landingRotation = 360 - centerOfWinner;
    
    // Add multiple full spins (e.g., 5 to 8 full spins)
    const extraSpins = (5 + Math.floor(Math.random() * 4)) * 360;
    
    // Calculate new total absolute rotation
    // We add extraSpins and landingRotation, and align it perfectly to the current rotation cycle
    const currentBase = Math.floor(rotation / 360) * 360; 
    const finalRotation = currentBase + extraSpins + landingRotation;
    
    setRotation(finalRotation);
    
    // Transition takes exactly 5 seconds (matched in inline styles)
    setTimeout(() => {
      setIsSpinning(false);
      const chosenWinner = checkedInUsers[winnerIndex];
      setWinner(chosenWinner);
      triggerExtravaganza();
    }, 5000); // 5000ms matches transition duration
  };

  if (numSegments === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
        <Crown size={64} className="mb-4 text-slate-600" />
        <h2 className="text-xl font-bold text-white mb-2">The Royal Spinner is empty</h2>
        <p>Awaiting checked-in guests...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full py-8">
      {/* Falling Crown Elements */}
      {crowns.map(c => (
        <div 
          key={c.id} 
          className="crown-emoji" 
          style={{ left: c.left, animationDelay: c.delay, animationDuration: c.duration }}
        >
          👑
        </div>
      ))}

      {/* Main Container */}
      <div className="bg-slate-800/80 backdrop-blur-md p-8 rounded-3xl shadow-2xl border border-slate-700/50 w-full max-w-2xl text-center relative z-10 flex flex-col items-center">
        
        <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-yellow-200 to-yellow-500 mb-8 uppercase tracking-widest drop-shadow-lg flex items-center justify-center gap-3">
          <Sparkles className="text-yellow-400" />
          The Royal Spinner
          <Sparkles className="text-yellow-400" />
        </h2>

        {/* Wheel Assembly */}
        <div className="relative mb-8 mt-4 select-none drop-shadow-2xl">
          {/* Outer Gold Rim */}
          <div className="absolute -inset-4 rounded-full bg-gradient-to-tr from-yellow-600 via-yellow-300 to-yellow-700 shadow-xl opacity-90 animate-[spin_10s_linear_infinite]" />
          
          {/* Inner Wheel Wrapper */}
          <div className="relative w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] rounded-full overflow-hidden border-8 border-slate-900 bg-slate-900 shadow-inner">
            
            {/* The Rotating Wheel */}
            <div 
              className="w-full h-full rounded-full transition-transform"
              style={{
                background: `conic-gradient(from 0deg, ${wheelGradient})`,
                transform: `rotate(${rotation}deg)`,
                transitionDuration: isSpinning ? '5s' : '0s',
                transitionTimingFunction: 'cubic-bezier(0.15, 0.85, 0.35, 1)' // smooth slow-down
              }}
            >
              {/* Text Overlays - Only render text if less than 50 people to avoid clutter */}
              {numSegments <= 30 && checkedInUsers.map((u, i) => {
                // Calculate rotation for each text label so it sits in the middle of its slice
                // Conic gradient 0 is top. CSS transform 0 is right. Adjust by -90 to align axes.
                const labelRotation = (i * sliceAngle) + (sliceAngle / 2) - 90;
                
                return (
                  <div 
                    key={u.id}
                    className="absolute top-1/2 left-1/2 w-[50%] h-8 -mt-4 origin-left flex items-center justify-end pr-8"
                    style={{ transform: `rotate(${labelRotation}deg)` }}
                  >
                    <span 
                      className={`text-white font-bold drop-shadow-md truncate ${numSegments > 15 ? 'text-xs' : 'text-sm sm:text-base'}`}
                      style={{ maxWidth: '80%' }} // Prevents text bleeding into center
                    >
                      {u.name}
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Center Hub */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-slate-900 border-4 border-yellow-400 rounded-full shadow-lg flex items-center justify-center z-20">
              <Crown className="text-yellow-400 w-8 h-8" />
            </div>
          </div>

          {/* Pointer (Top Center) */}
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[20px] border-r-[20px] border-t-[40px] border-l-transparent border-r-transparent border-t-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] z-30">
             {/* Decorative dot on pointer */}
             <div className="absolute -top-[35px] left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-sm"></div>
          </div>
        </div>

        {/* Spin Controls & Winner Announcement */}
        <div className="h-32 flex flex-col items-center justify-center w-full">
          {!winner ? (
            <button
              onClick={handleSpin}
              disabled={isSpinning || numSegments < 2}
              className={`px-12 py-4 rounded-full font-black text-xl uppercase tracking-wider transition-all duration-300 shadow-xl border-b-4 ${
                isSpinning || numSegments < 2
                  ? 'bg-slate-700 text-slate-500 border-slate-900 cursor-not-allowed'
                  : 'bg-gradient-to-b from-yellow-300 to-yellow-600 text-slate-900 border-yellow-700 hover:from-yellow-200 hover:to-yellow-500 hover:-translate-y-1 hover:shadow-yellow-500/50 active:translate-y-1 active:border-b-0'
              }`}
            >
              {isSpinning ? 'Spinning...' : numSegments < 2 ? 'Need more guests' : 'Spin the Wheel!'}
            </button>
          ) : (
            <div className="animate-in slide-in-from-bottom-4 zoom-in duration-500 w-full">
              <div className="text-yellow-400 font-bold text-sm tracking-[0.2em] mb-1">ALL HAIL</div>
              <div className="text-4xl sm:text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(255,215,0,0.8)] break-words px-4">
                {winner.name}
              </div>
              <button 
                onClick={() => setWinner(null)}
                className="mt-6 text-slate-400 hover:text-white underline text-sm transition-colors"
              >
                Spin Again
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}