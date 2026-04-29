import { createApp, ref, computed, watch, nextTick } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
    GraffitiPlugin,
    useGraffiti,
    useGraffitiSession,
    useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

const FAKE_TRANSLATIONS = {
    "오늘 뭐해?": "What are you up to today?",
    "카페 ㄱㄱ?": "Wanna go to a cafe?",
    "진짜? no way!": "Really? no way!",
    "밥 먹었어? lunch?": "Did you eat? lunch?",
};

function getFakeTranslation(text) {
    return FAKE_TRANSLATIONS[text] || "(translation unavailable)";
}

function setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();


    const activeDM = ref(null);
    const activeDMOtherName = ref("");
    const showHamburger = ref(false);
    const showProfileSetup = ref(false);
    const globalTranslation = ref(false);
    const revealedTranslations = ref(new Set());
    const messagesEl = ref(null);


    const myName = ref("");


    const { objects: myProfiles } = useGraffitiDiscover(
        () => session.value ? [session.value.actor] : [],
        {
            properties: {
                value: {
                    required: ["name", "describes"],
                    properties: {
                        name: { type: "string" },
                        describes: { type: "string" },
                    },
                },
            },
        },
        undefined,
        true,
    );

    watch(myProfiles, (profiles) => {
        if (profiles.length && !myName.value) {
            myName.value = profiles[0].value.name;
        }
    });

    async function saveProfile() {
        if (!myName.value.trim() || !session.value) return;

        for (const p of myProfiles.value) {
            if (p.actor === session.value.actor) {
                await graffiti.delete(p, session.value);
            }
        }
        await graffiti.post(
            {
                value: {
                    name: myName.value.trim(),
                    describes: session.value.actor,
                    published: Date.now(),
                },
                channels: [session.value.actor, "designftw-26-profiles"],
            },
            session.value,
        );
        showProfileSetup.value = false;
    }


    const profileSearch = ref("");
    const isSearching = ref(false);


    const { objects: allProfiles } = useGraffitiDiscover(
        ["designftw-26-profiles"],
        {
            properties: {
                value: {
                    required: ["name", "describes"],
                    properties: {
                        name: { type: "string" },
                        describes: { type: "string" },
                    },
                },
            },
        },
        undefined,
        true,
    );


    const seedProfiles = [
        { actor: "did:plc:seed-minji-jang", value: { name: "Minji Jang", describes: "did:plc:seed-minji-jang" } },
        { actor: "did:plc:seed-jake-kim", value: { name: "Jake Kim", describes: "did:plc:seed-jake-kim" } },
        { actor: "did:plc:seed-sujin-park", value: { name: "Sujin Park", describes: "did:plc:seed-sujin-park" } },
    ];

    const searchResults = computed(() => {
        if (!profileSearch.value.trim()) return [];
        const q = profileSearch.value.toLowerCase();
        const real = allProfiles.value.filter(
            (p) => p.value.name.toLowerCase().includes(q) && p.actor !== session.value?.actor,
        );
        const seeds = seedProfiles.filter(
            (p) => p.value.name.toLowerCase().includes(q) && p.actor !== session.value?.actor,
        );
        const seen = new Set(real.map((p) => p.actor));
        const labeledSeeds = seeds
            .filter((p) => !seen.has(p.actor))
            .map((p) => ({ ...p, value: { ...p.value, name: p.value.name + " (fake)" } }));
        return [...real, ...labeledSeeds];
    });

    function searchProfiles() {
        isSearching.value = true;
        setTimeout(() => (isSearching.value = false), 300);
    }



    const { objects: joinedDMs, isFirstPoll: areDMsLoading } = useGraffitiDiscover(
        () => session.value ? [session.value.actor + "/dms"] : [],
        {
            properties: {
                value: {
                    required: ["activity", "type", "channel", "otherActor", "published"],
                    properties: {
                        activity: { type: "string", const: "Join" },
                        type: { type: "string", const: "DirectMessage" },
                        channel: { type: "string" },
                        otherActor: { type: "string" },
                        published: { type: "number" },
                    },
                },
            },
        },
        undefined,
        true,
    );


    const sortedDMs = computed(() => {
        return joinedDMs.value
            .map((dm) => {
                const realProfile = allProfiles.value.find(
                    (p) => p.actor === dm.value.otherActor,
                );
                const seedProfile = seedProfiles.find(
                    (p) => p.actor === dm.value.otherActor,
                );
                const name = realProfile?.value.name
                    || (seedProfile ? seedProfile.value.name + " (fake)" : "Unknown");
                return {
                    ...dm,
                    _otherName: name,
                    _lastMessage: "",
                    _lastTime: formatTime(dm.value.published),
                };
            })
            .sort((a, b) => b.value.published - a.value.published);
    });

    function otherActor(dm) {
        return dm.value?.otherActor || "";
    }

    const SEED_ACTOR_PREFIX = "did:plc:seed-";


    async function startDM(profile) {
        if (!session.value) return;
        profileSearch.value = "";


        const existing = joinedDMs.value.find(
            (dm) => dm.value.otherActor === profile.actor,
        );
        if (existing) {
            openDM(existing);
            return;
        }

        const channel = crypto.randomUUID();
        const isSeed = profile.actor.startsWith(SEED_ACTOR_PREFIX);


        await graffiti.post(
            {
                value: {
                    activity: "Join",
                    type: "DirectMessage",
                    channel,
                    otherActor: profile.actor,
                    published: Date.now(),
                },
                channels: [session.value.actor + "/dms"],
                allowed: [],
            },
            session.value,
        );


        if (!isSeed) {
            await graffiti.post(
                {
                    value: {
                        activity: "Join",
                        type: "DirectMessage",
                        channel,
                        otherActor: session.value.actor,
                        published: Date.now(),
                    },
                    channels: [profile.actor + "/dms"],
                    allowed: [profile.actor],
                },
                session.value,
            );
        }


        const newDM = joinedDMs.value.find((dm) => dm.value.channel === channel);
        if (newDM) openDM(newDM);
        else {
            activeDM.value = {
                value: { channel, otherActor: profile.actor },
            };

            activeDMOtherName.value = profile.value.name;
        }
    }

    function openDM(dm) {
        activeDM.value = dm;
        const realProfile = allProfiles.value.find(
            (p) => p.actor === dm.value.otherActor,
        );
        const seedProfile = seedProfiles.find(
            (p) => p.actor === dm.value.otherActor,
        );
        activeDMOtherName.value = realProfile?.value.name
            || (seedProfile ? seedProfile.value.name + " (fake)" : "Unknown");
        globalTranslation.value = false;
        revealedTranslations.value = new Set();
        showHamburger.value = false;
    }

    function closeDM() {
        activeDM.value = null;
        showHamburger.value = false;
    }


    const activeChannel = computed(() => activeDM.value?.value?.channel);


    const SEED_MESSAGES = {
        "did:plc:seed-minji-jang": [
            { content: "오늘 뭐해?", translation: "What are you up to today?", published: Date.now() - 5 * 60000 },
            { content: "카페 ㄱㄱ?", translation: "Wanna go to a cafe?", published: Date.now() - 3 * 60000 },
            { content: "ㅋㅋ okay see you there", translation: "lol okay see you there", published: Date.now() - 1 * 60000 },
        ],
        "did:plc:seed-jake-kim": [
            { content: "sounds good!", translation: null, published: Date.now() - 4 * 60000 },
            { content: "진짜? no way!", translation: "Really? No way!", published: Date.now() - 2 * 60000 },
        ],
        "did:plc:seed-sujin-park": [
            { content: "밥 먹었어? lunch?", translation: "Did you eat? Lunch?", published: Date.now() - 6 * 60000 },
            { content: "ㅠㅠ 나 너무 바빠", translation: "I'm so busy :(", published: Date.now() - 2 * 60000 },
        ],
    };

    const { objects: messageObjects, isFirstPoll: areMessagesLoading } =
        useGraffitiDiscover(
            () => (activeChannel.value ? [activeChannel.value] : []),
            {
                properties: {
                    value: {
                        required: ["content", "published"],
                        properties: {
                            content: { type: "string" },
                            published: { type: "number" },
                        },
                    },
                },
            },
            undefined,
            true,
        );

    const sortedMessages = computed(() => {
        const real = messageObjects.value.toSorted(
            (a, b) => a.value.published - b.value.published,
        );

        const otherActor = activeDM.value?.value?.otherActor;
        const fakes = (SEED_MESSAGES[otherActor] || []).map((m, i) => ({
            url: "seed-msg-" + otherActor + i,
            actor: otherActor,
            value: m,
        }));
        return [...fakes, ...real].sort((a, b) => a.value.published - b.value.published);
    });


    watch(sortedMessages, async () => {
        await nextTick();
        if (messagesEl.value) {
            messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        }
    });

    const myMessage = ref("");
    const isSending = ref(false);

    async function sendMessage() {
        if (!myMessage.value.trim() || !session.value || !activeChannel.value) return;
        const isSeed = activeDM.value?.value?.otherActor?.startsWith(SEED_ACTOR_PREFIX);
        isSending.value = true;
        try {
            await graffiti.post(
                {
                    value: {
                        content: myMessage.value.trim(),
                        published: Date.now(),
                    },
                    channels: [activeChannel.value],

                    ...(isSeed ? {} : { allowed: [session.value.actor, activeDM.value.value.otherActor] }),
                },
                session.value,
            );
            myMessage.value = "";
        } finally {
            isSending.value = false;
        }
    }

    const isDeleting = ref(new Set());
    async function deleteMessage(msg) {
        isDeleting.value.add(msg.url);
        try {
            await graffiti.delete(msg, session.value);
        } finally {
            isDeleting.value.delete(msg.url);
        }
    }


    function toggleGlobalTranslation() {
        globalTranslation.value = !globalTranslation.value;
        if (!globalTranslation.value) {
            revealedTranslations.value = new Set();
        }
        showHamburger.value = false;
    }

    function toggleTranslation(url) {
        const next = new Set(revealedTranslations.value);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        revealedTranslations.value = next;
    }


    watch(messageObjects, (msgs) => {
        msgs.forEach((msg) => {
            if (!msg.value.translation && msg.actor !== session.value?.actor) {
                msg.value.translation = getFakeTranslation(msg.value.content);
            }
        });
    });


    function initials(name) {
        if (!name) return "?";
        return name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    }

    function avatarColor(str) {
        const colors = [
            "#ffb3ba", "#ffdfba", "#ffffba", "#baffc9",
            "#bae1ff", "#d4baff", "#ffd4ba", "#c9baff",
        ];
        let hash = 0;
        for (const c of str || "") hash = c.charCodeAt(0) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    function formatTime(ts) {
        if (!ts) return "";
        const d = new Date(ts);
        const now = new Date();
        const diffDays = Math.floor((now - d) / 86400000);
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (diffDays === 1) return "Yesterday";
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    return {

        myName, showProfileSetup, saveProfile,

        profileSearch, searchResults, isSearching, searchProfiles,

        sortedDMs, areDMsLoading, otherActor, startDM, openDM, closeDM,

        activeDM, activeDMOtherName, sortedMessages, areMessagesLoading,
        myMessage, isSending, sendMessage, isDeleting, deleteMessage,

        globalTranslation, revealedTranslations, toggleGlobalTranslation, toggleTranslation,
        showHamburger,
        messagesEl,

        initials, avatarColor, formatTime,
    };
}

const App = { template: "#template", setup };

createApp(App)
    .use(GraffitiPlugin, {
        graffiti: new GraffitiDecentralized(),
    })
    .mount("#app");
