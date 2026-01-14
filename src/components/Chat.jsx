import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import axios from 'axios';
import gsap from 'gsap';
import EmojiPicker from 'emoji-picker-react';

const ENDPOINT = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const Chat = () => {
    const { user, logout } = useAuth();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [moods, setMoods] = useState({});
    const [currentMood, setCurrentMood] = useState('Happy');
    const [isPartnerTyping, setIsPartnerTyping] = useState(false); // [NEW]
    const moodOptions = ['Happy', 'Sad', 'Romantic', 'Excited', 'Tired', 'In Love'];
    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const heartsContainerRef = useRef(null);
    const reactionContainerRef = useRef(null);
    const typingTimeoutRef = useRef(null); // [NEW]

    useEffect(() => {
        socketRef.current = io(ENDPOINT, {
            auth: { token: user.token }
        });

        socketRef.current.emit('join', user.username);

        socketRef.current.on('receiveMessage', (message) => {
            setMessages((prev) => [...prev, message]);
            setIsPartnerTyping(false); // Stop typing if message received

            // Floating hearts if message is from the other person
            if (message.sender !== user.username) {
                showLoveAnimation();
                // Mark as seen immediately if we are online/connected
                socketRef.current.emit('markSeen', { viewer: user.username, sender: message.sender });
            }
        });

        socketRef.current.on('messagesCleared', () => {
            setMessages([]);
        });

        socketRef.current.on('moodUpdate', (newMoods) => {
            setMoods(newMoods);
            if (newMoods[user.username]) {
                setCurrentMood(newMoods[user.username]);
            }
        });

        socketRef.current.on('receiveReaction', ({ sender, type }) => {
            if (type === 'vote_hug') showVirtualReaction('🤗');
            else if (type === 'vote_kiss') showVirtualReaction('💋');
        });

        // [NEW] Typing Events
        socketRef.current.on('typing', ({ sender }) => {
            if (sender !== user.username) setIsPartnerTyping(true);
        });

        socketRef.current.on('stopTyping', ({ sender }) => {
            if (sender !== user.username) setIsPartnerTyping(false);
        });

        // [NEW] Messages Seen Event
        socketRef.current.on('messagesSeen', ({ viewer, sender }) => {
            if (sender === user.username) {
                // My messages were seen by the viewer
                setMessages(prev => prev.map(msg =>
                    msg.sender === user.username ? { ...msg, seen: 1 } : msg
                ));
            }
        });

        axios.get(`${ENDPOINT}/api/messages`, {
            headers: { Authorization: `Bearer ${user.token}` }
        }).then(res => {
            const fetchedMessages = res.data;
            setMessages(fetchedMessages);

            // Mark fetched messages from partner as seen
            const partnerMessages = fetchedMessages.filter(m => m.sender !== user.username && !m.seen);
            if (partnerMessages.length > 0) {
                // We can simply mark the 'sender' of these messages as seen
                // Assuming 1-on-1 chat, the sender is always the partner
                const partnerName = partnerMessages[0].sender;
                socketRef.current.emit('markSeen', { viewer: user.username, sender: partnerName });
            }

        }).catch(err => console.error(err));

        return () => {
            socketRef.current.disconnect();
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        };
    }, [user]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isPartnerTyping]); // Scroll when typing starts too

    const showLoveAnimation = () => {
        if (!heartsContainerRef.current) return;
        for (let i = 0; i < 15; i++) {
            const heart = document.createElement('div');
            heart.innerText = '❤️';
            heart.style.position = 'absolute';
            heart.style.left = Math.random() * 100 + '%';
            heart.style.bottom = '-20px';
            heart.style.fontSize = Math.random() * 20 + 20 + 'px';
            heart.style.opacity = 1;
            heart.style.pointerEvents = 'none';

            heartsContainerRef.current.appendChild(heart);

            gsap.to(heart, {
                y: -window.innerHeight * 0.8,
                x: (Math.random() - 0.5) * 100,
                rotation: Math.random() * 90 - 45,
                opacity: 0,
                duration: 2 + Math.random() * 3,
                ease: 'power1.out',
                onComplete: () => {
                    if (heart.parentNode) heart.parentNode.removeChild(heart);
                }
            });
        }
    };

    const showVirtualReaction = (emoji) => {
        if (!reactionContainerRef.current) return;

        const el = document.createElement('div');
        el.innerText = emoji;
        el.style.position = 'absolute';
        el.style.left = Math.random() * 80 + 10 + '%';
        el.style.top = Math.random() * 80 + 10 + '%';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.fontSize = '0px';
        el.style.zIndex = 100;
        el.style.pointerEvents = 'none';

        reactionContainerRef.current.appendChild(el);

        gsap.to(el, {
            fontSize: '300px',
            duration: 1,
            ease: 'elastic.out(1, 0.3)',
            onComplete: () => {
                gsap.to(el, {
                    opacity: 0,
                    duration: 0.5,
                    delay: 0.5,
                    onComplete: () => {
                        if (el.parentNode) el.parentNode.removeChild(el);
                    }
                });
            }
        });
    };

    const sendReaction = (type) => {
        socketRef.current.emit('sendReaction', { sender: user.username, type });
        showVirtualReaction(type === 'vote_hug' ? '🤗' : '💋'); // Show for self too? Maybe yes. User said "pop on the screen".
    };

    const handleMoodChange = (e) => {
        const newMood = e.target.value;
        setCurrentMood(newMood);
        socketRef.current.emit('setMood', { username: user.username, mood: newMood });
    };

    const handleInputChange = (e) => {
        setInput(e.target.value);

        socketRef.current.emit('typing', { sender: user.username });

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        typingTimeoutRef.current = setTimeout(() => {
            socketRef.current.emit('stopTyping', { sender: user.username });
        }, 1500);
    };

    const sendMessage = (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        socketRef.current.emit('stopTyping', { sender: user.username });

        socketRef.current.emit('sendMessage', {
            sender: user.username,
            content: input,
            token: user.token
        });
        setInput('');
        setShowEmoji(false);
    };

    const onEmojiClick = (emojiObject) => {
        setInput((prev) => prev + emojiObject.emoji);
    };

    const partnerName = user.username === 'cherie' ? 'booboo' : 'cherie';
    const partnerMood = moods[partnerName] || 'Unknown';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: '800px', margin: '0 auto', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>

            {/* Floating Hearts Container */}
            <div ref={heartsContainerRef} style={{ pointerEvents: 'none', position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden', zIndex: 10 }}></div>
            {/* Reaction Container (Center) */}
            <div ref={reactionContainerRef} style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center' }}></div>

            {/* Header */}
            <header style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-paper)', zIndex: 20 }}>
                <div>
                    {/* Title Removed */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {partnerName}: <span style={{ color: 'var(--accent)' }}>{partnerMood}</span>
                    </div>
                </div>


                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <br />
                    <select
                        value={currentMood}
                        onChange={handleMoodChange}
                        style={{ background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.25rem' }}
                    >
                        {moodOptions.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>

                    <button onClick={() => sendReaction('vote_hug')} title="Send Hug" style={{ fontSize: '1.2rem', background: 'transparent' }}>🤗</button>
                    <button onClick={() => sendReaction('vote_kiss')} title="Send Kiss" style={{ fontSize: '1.2rem', background: 'transparent' }}>💋</button>

                    <button
                        onClick={() => {
                            if (confirm('Are you sure you want to delete all messages? This cannot be undone.')) {
                                axios.delete(`${ENDPOINT}/api/messages`, { headers: { Authorization: `Bearer ${user.token}` } })
                                    .catch(err => console.error(err));
                            }
                        }}
                        style={{ padding: '0.5rem', background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: '4px', fontSize: '0.8rem' }}
                    >
                        Clear
                    </button>
                    <button
                        onClick={logout}
                        style={{ padding: '0.5rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '4px', fontSize: '0.8rem' }}
                    >
                        Logout
                    </button>
                </div>
            </header>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', zIndex: 1 }}>
                {messages.map((msg, index) => {
                    const isOwn = msg.sender === user.username;
                    return (
                        <div
                            key={index}
                            className="message-bubble"
                            style={{
                                alignSelf: isOwn ? 'flex-end' : 'flex-start',
                                maxWidth: '70%',
                                padding: '0.75rem 1rem',
                                borderRadius: '12px',
                                background: isOwn ? 'var(--accent)' : 'var(--bg-paper)',
                                color: isOwn ? '#fff' : 'var(--text-primary)',
                                borderBottomRightRadius: isOwn ? '2px' : '12px',
                                borderBottomLeftRadius: isOwn ? '12px' : '2px',
                                opacity: 0,
                                animation: 'fadeIn 0.3s forwards',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: isOwn ? 'flex-end' : 'flex-start'
                            }}
                        >
                            <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '2px', alignSelf: 'flex-start' }}>{msg.sender}</div>
                            <div style={{ alignSelf: 'flex-start' }}>{msg.content}</div>
                            {isOwn && (
                                <div style={{ fontSize: '0.6rem', opacity: 0.8, marginTop: '4px', alignSelf: 'flex-end' }}>
                                    {msg.seen ? '✓✓ Seen' : '✓ Sent'}
                                </div>
                            )}
                        </div>
                    );
                })}
                {isPartnerTyping && (
                    <div style={{
                        alignSelf: 'flex-start',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        fontStyle: 'italic',
                        marginLeft: '1rem',
                        marginBottom: '0.5rem'
                    }}>
                        {partnerName} is typing...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ position: 'relative', zIndex: 20 }}>
                {showEmoji && (
                    <div style={{ position: 'absolute', bottom: '80px', left: '1rem' }}>
                        <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                    </div>
                )}
                <form onSubmit={sendMessage} style={{ padding: '1rem', background: 'var(--bg-paper)', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button
                        type="button"
                        onClick={() => setShowEmoji(!showEmoji)}
                        style={{ background: 'transparent', fontSize: '1.5rem', cursor: 'pointer' }}
                    >
                        😀
                    </button>
                    <input
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                        style={{ flex: 1, padding: '0.75rem', borderRadius: '24px', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
                    />
                    <button
                        type="submit"
                        style={{ padding: '0.75rem 1.5rem', borderRadius: '24px', background: 'var(--accent)', color: '#fff', fontWeight: 600 }}
                    >
                        Send
                    </button>
                </form>
            </div>

            <style>{`
        @keyframes fadeIn {
          to { opacity: 1; transform: translateY(0); }
          from { opacity: 0; transform: translateY(10px); }
        }
      `}</style>
        </div>
    );
};

export default Chat;
