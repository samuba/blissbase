import { matchesWholeWord, slugify } from './common';

export const OTHERS_CATEGORY_SLUG = `others`;

export const eventCategories: EventCategory[] = [
	{
		slug: `dance`,
		get label() { return /* @wc-include */ `Tanz`; },
		tags: [
			{
				slug: `dance`,
				get label() { /* @wc-include */ return `Tanz`; },
				synonyms: [`Dance`, `Tanzen`, `Dance Class`, `Dance Party`, `Social Dance`, `Dance Jam`]
			},
			{
				slug: `ecstatic-dance`,
				get label() { /* @wc-include */ return `Ecstatic Dance`; },
				synonyms: [`Ekstatischer Tanz`, `ED`]
			},
			{
				slug: `conscious-dance`,
				get label() { /* @wc-include */ return `Conscious Dance`; },
				synonyms: [`Bewusster Tanz`]
			},
			{
				slug: `5rhythms`,
				get label() { /* @wc-include */ return `5Rhythmen`; },
				synonyms: [`5Rhythms`, `5Rhythms® Dance`, `5 Rhythmen`, `5 Rhythms`, `Five Rhythms`]
			},
			{
				slug: `contact-improvisation`,
				get label() { /* @wc-include */ return `Contact Improvisation`; },
				synonyms: [`Contact Jam`, `Contact Improv`, `Contactimprovisation`, `Contact-Tango`, `CI`]
			},
			{
				slug: `biodanza`,
				get label() { /* @wc-include */ return `Biodanza`; },
				synonyms: [`Biodanza Rolando Toro`, `Bio Dance`]
			},
			{
				slug: `movement-medicine`,
				get label() { /* @wc-include */ return `Movement Medicine`; },
				synonyms: [`Bewegungsmedizin`]
			},
			{
				slug: `open-floor`,
				get label() { /* @wc-include */ return `Open Floor`; },
				synonyms: [`OpenFloor`]
			},
			{
				slug: `somatic-dance`,
				get label() { /* @wc-include */ return `Somatischer Tanz`; },
				synonyms: [`Somatic Dance`]
			},
			{
				slug: `dance-meditation`,
				get label() { /* @wc-include */ return `Tanzmeditation`; },
				synonyms: [`Meditative Dance`, `Dance Meditation`]
			},
			{
				slug: `dance-improvisation`,
				get label() { /* @wc-include */ return `Tanzimprovisation`; },
				synonyms: [`Tanzimpro`, `dance-impro`, `Dance Improvisation`, `DanceImprovisation`, `Dance Impro`]
			},
			{
				slug: `tantric-dance`,
				get label() { /* @wc-include */ return `Tantrischer Tanz`; },
				synonyms: [`Tantric Dance`, `Tantratanz`]
			},
			{
				slug: `trance-dance`,
				get label() { /* @wc-include */ return `Trance Dance`; },
				synonyms: [`Trancetanz`]
			},
			{
				slug: `shamanic-dance`,
				get label() { /* @wc-include */ return `Schamanischer Tanz`; },
				synonyms: [`Shamanic Dance`, `Schamanentanz`]
			},
			{
				slug: `intuitive-dance`,
				get label() { /* @wc-include */ return `Intuitiver Tanz`; },
				synonyms: [`Intuitive Dance`]
			},
			{
				slug: `free-dance`,
				get label() { /* @wc-include */ return `Freier Tanz`; },
				synonyms: [`Free Dance`, `Freestyle Dance`]
			},
			{
				slug: `dancing-in-connection`,
				get label() { /* @wc-include */ return `Tanzen in Verbindung`; },
				synonyms: [`Dancing in Connection`]
			},
			{
				slug: `ritual-dance`,
				get label() { /* @wc-include */ return `Ritueller Tanz`; },
				synonyms: [`Tanzritual`, `Ritual Dance`]
			},
			{
				slug: `zouk`,
				get label() { /* @wc-include */ return `Zouk`; },
				synonyms: [`Brazilian Zouk`, `Zouk Dance`]
			},
			{
				slug: `sufi-dance`,
				get label() { /* @wc-include */ return `Sufi-Tanz`; },
				synonyms: [`Sufi Dance`, `Sufi Whirling`]
			},
			{
				slug: `dance-performance`,
				get label() { /* @wc-include */ return `Tanzperformance`; },
				synonyms: [`Dance Performance`]
			},
			{
				slug: `whirling`,
				get label() { /* @wc-include */ return `Wirbeltanz`; },
				synonyms: [`Whirling`, `Wirbeln`, `Derwischtanz`]
			},
			{
				slug: `dance-workshop`,
				get label() { /* @wc-include */ return `Tanzworkshop`; },
				synonyms: [`Dance Workshop`]
			},
			{
				slug: `conscious-clubbing`,
				get label() { /* @wc-include */ return `Conscious Clubbing`; },
				synonyms: [`Mindful Clubbing`, `Sober Rave`, `Conscious Rave`]
			},
			{
				slug: `sensual-dance`,
				get label() { /* @wc-include */ return `Sinnlicher Tanz`; },
				synonyms: [`Sensual Dance`]
			},
			{
				slug: `bellydance`,
				get label() { /* @wc-include */ return `Bauchtanz`; },
				synonyms: [`Belly Dance`, `Bellydance`, `Orientalischer Tanz`]
			},
			{
				slug: `contemporary-dance`,
				get label() { /* @wc-include */ return `Contemporary Dance`; },
				synonyms: [`Contemporary`, `Zeitgenössischer Tanz`]
			},
			{
				slug: `afro-dance`,
				get label() { /* @wc-include */ return `Afro Dance`; },
				synonyms: [`Afrotanz`, `Afrobeats`, `Afro House`]
			},
			{
				slug: `childrens-dance`,
				get label() { /* @wc-include */ return `Kindertanz`; },
				synonyms: [`Children's Dance`, `Kinder Tanz`]
			},
			{
				slug: `dance-coaching`,
				get label() { /* @wc-include */ return `Tanzcoaching`; },
				synonyms: [`Dance Coaching`]
			},
			{
				slug: `sacred-dance`,
				get label() { /* @wc-include */ return `Heiliger Tanz`; },
				synonyms: [`Sacred Dance`]
			},
			{
				slug: `embodiment-dance`,
				get label() { /* @wc-include */ return `Embodiment Dance`; },
				synonyms: [`Embodied Dance`, `Embodyment Dance`]
			},
			{
				slug: `contact-beyond-contact`,
				get label() { /* @wc-include */ return `Contact Beyond Contact`; },
				synonyms: [`CBC`]
			},
			{
				slug: `outdoor-dance`,
				get label() { /* @wc-include */ return `Tanz im Freien`; },
				synonyms: [`Outdoor Dance`]
			},
			{
				slug: `forro`,
				get label() { /* @wc-include */ return `Forró`; },
				synonyms: [`Forro`]
			},
			{
				slug: `yogadanza`,
				get label() { /* @wc-include */ return `Yogadanza`; },
				synonyms: [`Yoga Dance`, `Yoga-Tanz`]
			},
			{
				slug: `folk-dance`,
				get label() { /* @wc-include */ return `Volkstanz`; },
				synonyms: [`Folk Dance`, `Folklore Tanz`]
			},
			{
				slug: `balfolk`,
				get label() { /* @wc-include */ return `Balfolk`; },
				synonyms: [`Bal Folk`]
			},
			{
				slug: `latin-dance`,
				get label() { /* @wc-include */ return `Latin Dance`; },
				synonyms: [`Latinotanz`, `Bachata`, `Tango`, `Salsa`, `Kizomba`]
			},
			{
				slug: `systemic-dance`,
				get label() { /* @wc-include */ return `Systemischer Tanz`; },
				synonyms: [`Systemic Dance`]
			},
			{
				slug: `haka`,
				get label() { /* @wc-include */ return `Haka`; },
				synonyms: [`Maori Haka`]
			},
		],
	},
	{
		slug: `breathwork`,
		get label() { return /* @wc-include */ `Breathwork`; },
		tags: [
			{
				slug: `breath`,
				get label() { /* @wc-include */ return `Atem`; },
				synonyms: [`Breath`, `atmen`, `Atmung`]
			},
			{
				slug: `breathwork`,
				get label() { /* @wc-include */ return `Breathwork`; },
				synonyms: [`Atemarbeit`, `Atemtechniken`, `Atemübungen`]
			},
			{
				slug: `breath-circle`,
				get label() { /* @wc-include */ return `Atemkreis`; },
				synonyms: [`Breath Circle`]
			},
			{
				slug: `rebirthing`,
				get label() { /* @wc-include */ return `Rebirthing`; },
				synonyms: [`Rebirthing Breathwork`, `rebirthing-breathwork`]
			},
			{
				slug: `wim-hof-method`,
				get label() { /* @wc-include */ return `Wim-Hof-Methode`; },
				synonyms: [`Wim Hof`, `Wim Hof Method`, `WHM`]
			},
			{
				slug: `ice-bath`,
				get label() { /* @wc-include */ return `Eisbad`; },
				synonyms: [`Ice Bath`, `Eisbaden`, `Cold Plunge`, `Kaltbaden`]
			},
			{
				slug: `conscious-connected-breathwork`,
				get label() { /* @wc-include */ return `Conscious Connected Breathwork`; },
				synonyms: [`CCB`, `Connected Breathwork`, `Bewusst verbundenes Atmen`]
			},
			{
				slug: `holotropic-breathwork`,
				get label() { /* @wc-include */ return `Holotropes Atmen`; },
				synonyms: [`Holotropic Breathwork`, `Holotropic`, `holotropicstyle-breathwork`]
			},
			{
				slug: `transformational-breathwork`,
				get label() { /* @wc-include */ return `Transformatives Atmen`; },
				synonyms: [`Transformational Breathwork`, `Transformational Breath`]
			},
			{
				slug: `functional-breathing`,
				get label() { /* @wc-include */ return `Funktionales Atmen`; },
				synonyms: [`Functional Breathing`, `Buteyko`]
			},
			{
				slug: `pranayama`,
				get label() { /* @wc-include */ return `Pranayama`; },
				synonyms: [`Yogisches Atmen`]
			},
			{
				slug: `breath-retention`,
				get label() { /* @wc-include */ return `Atemanhalten`; },
				synonyms: [`Breath Retention`, `Kumbhaka`]
			},
			{
				slug: `breath-cold-exposure`,
				get label() { /* @wc-include */ return `Atem und Kälte`; },
				synonyms: [`Breath and Cold`, `Atem und Kaelte`]
			},
		],
	},
	{
		slug: `tantra`,
		get label() { return /* @wc-include */ `Tantra`; },
		tags: [
			{
				slug: `tantra`,
				get label() { /* @wc-include */ return `Tantra`; },
				synonyms: [`Tantrisch`, `Tantric`]
			},
			{
				slug: `tantric-dance`,
				get label() { /* @wc-include */ return `Tantrischer Tanz`; }
			},
			{
				slug: `conscious-sexuality`,
				get label() { /* @wc-include */ return `Bewusste Sexualität`; },
				synonyms: [`Conscious Sexuality`]
			},
			{
				slug: `sacred-sexuality`,
				get label() { /* @wc-include */ return `Heilige Sexualität`; },
				synonyms: [`Sacred Sexuality`]
			},
			{
				slug: `transformational-sexuality`,
				get label() { /* @wc-include */ return `Transformative Sexualität`; },
				synonyms: [`Transformational Sexuality`]
			},
			{
				slug: `temple`,
				get label() { /* @wc-include */ return `Tempel`; },
				synonyms: [`Temple`, `Tempelabend`, `Temple Night`]
			},
			{
				slug: `sensuality`,
				get label() { /* @wc-include */ return `Sinnlichkeit`; },
				synonyms: [`Sensuality`, `Lust`]
			},
			{
				slug: `intimacy`,
				get label() { /* @wc-include */ return `Intimität`; },
				synonyms: [`Intimacy`]
			},
			{
				slug: `sexuality`,
				get label() { /* @wc-include */ return `Sexualität`; },
				synonyms: [`Sexuality`, `Erotic`, `Erotik`, `Sexpositiv`, `Sex-positiv`]
			},
			{
				slug: `shibari`,
				get label() { /* @wc-include */ return `Shibari`; },
				synonyms: [`Kinbaku`, `Rope Art`, `Seilkunst`, `Bondage`, `BDSM`]
			},
			{
				slug: `classical-tantra`,
				get label() { /* @wc-include */ return `Klassisches Tantra`; },
				synonyms: [`Classical Tantra`]
			},
			{
				slug: `neotantra`,
				get label() { /* @wc-include */ return `Neotantra`; },
				synonyms: [`Neo-Tantra`, `Neo Tantra`]
			},
			{
				slug: `sexual-embodiment`,
				get label() { /* @wc-include */ return `Sexuelles Embodiment`; },
				synonyms: [`Sexual Embodiment`]
			},
			{
				slug: `conscious-touch`,
				get label() { /* @wc-include */ return `Bewusste Berührung`; },
				synonyms: [`Conscious Touch`, `Mindful Touch`]
			},
			{
				slug: `cuddle`,
				get label() { /* @wc-include */ return `Kuscheln`; },
				synonyms: [`Cuddle`, `Cuddling`, `Kuschelparty`, `Cuddle Party`, `Cuddle Workshop`, `Cuddle Workshops`, `Kuschelabend`]
			},
			{
				slug: `intimacy-practice`,
				get label() { /* @wc-include */ return `Intimitätspraxis`; },
				synonyms: [`Intimacy Practice`]
			},
			{
				slug: `erotic-energy`,
				get label() { /* @wc-include */ return `Erotische Energie`; },
				synonyms: [`Erotic Energy`]
			},
			{
				slug: `polarity`,
				get label() { /* @wc-include */ return `Polarität`; },
				synonyms: [`Polarity`, `Polaritätsarbeit`]
			},
			{
				slug: `temple-arts`,
				get label() { /* @wc-include */ return `Tempelkünste`; },
				synonyms: [`Temple Arts`]
			},
			{
				slug: `play-party`,
				get label() { /* @wc-include */ return `Play Party`; },
				synonyms: [`Playparty`, `Spielparty`]
			},
		],
	},
	{
		slug: `meditation`,
		get label() { return /* @wc-include */ `Meditation`; },
		tags: [
			{
				slug: `meditation`,
				get label() { /* @wc-include */ return `Meditation`; },
				synonyms: [`Meditieren`, `Meditatie`]
			},
			{
				slug: `mindfulness`,
				get label() { /* @wc-include */ return `Achtsamkeit`; },
				synonyms: [`Mindfulness`, `MBSR`, `Achtsamkeitsmeditation`]
			},
			{
				slug: `yoga-nidra`,
				get label() { /* @wc-include */ return `Yoga Nidra`; },
				synonyms: [`Yoganidra`, `Yoga-Nidra`, `Yogischer Schlaf`]
			},
			{
				slug: `insight-dialogue`,
				get label() { /* @wc-include */ return `Insight Dialogue`; },
				synonyms: [`Insight Dialogue Meditation`]
			},
			{
				slug: `dance-meditation`,
				get label() { /* @wc-include */ return `Tanzmeditation`; }
			},
			{
				slug: `satsang`,
				get label() { /* @wc-include */ return `Satsang`; }
			},
			{
				slug: `being-orientation`,
				get label() { /* @wc-include */ return `Seinsorientierung`; },
				synonyms: [`Being Orientation`, `Zijnsoriëntatie`]
			},
			{
				slug: `vipassana`,
				get label() { /* @wc-include */ return `Vipassana`; },
				synonyms: [`Vipassanā`, `Einsichtsmeditation`]
			},
			{
				slug: `zen-meditation`,
				get label() { /* @wc-include */ return `Zen-Meditation`; },
				synonyms: [`Zen`, `Zazen`, `Zen Meditation`]
			},
			{
				slug: `guided-meditation`,
				get label() { /* @wc-include */ return `Geführte Meditation`; },
				synonyms: [`Guided Meditation`]
			},
			{
				slug: `silent-meditation`,
				get label() { /* @wc-include */ return `Stille Meditation`; },
				synonyms: [`Silent Meditation`]
			},
			{
				slug: `walking-meditation`,
				get label() { /* @wc-include */ return `Gehmeditation`; },
				synonyms: [`Walking Meditation`, `Kinhin`]
			},
			{
				slug: `non-dual-meditation`,
				get label() { /* @wc-include */ return `Nonduale Meditation`; },
				synonyms: [`Nondual Meditation`, `Non-dual Meditation`]
			},
			{
				slug: `visualization`,
				get label() { /* @wc-include */ return `Visualisierung`; },
				synonyms: [`Visualisation`, `Imagination`]
			},
			{
				slug: `contemplative-practice`,
				get label() { /* @wc-include */ return `Kontemplative Praxis`; },
				synonyms: [`Contemplation`, `Kontemplation`]
			},
			{
				slug: `silence`,
				get label() { /* @wc-include */ return `Stille`; },
				synonyms: [`Silence`, `Schweigeretreat`, `Silent Retreat`, `Stillezeit`]
			},
		],
	},
	{
		slug: `movement`,
		get label() { return /* @wc-include */ `Bewegung`; },
		tags: [
			{
				slug: `movement`,
				get label() { /* @wc-include */ return `Bewegung`; },
				synonyms: [`Movement`, `Bewegungspraxis`]
			},
			{
				slug: `playfight`,
				get label() { /* @wc-include */ return `Playfight`; },
				synonyms: [`Play Fight`, `Playfighting`, `Kampfspiel`]
			},
			{
				slug: `acro-yoga`,
				get label() { /* @wc-include */ return `Acro Yoga`; },
				synonyms: [`Acroyoga`, `AcroYoga`, `Partnerakrobatik`]
			},
			{
				slug: `partner-movement`,
				get label() { /* @wc-include */ return `Partnerbewegung`; },
				synonyms: [`Partner Movement`, `Partnering`]
			},
			{
				slug: `authentic-movement`,
				get label() { /* @wc-include */ return `Authentic Movement`; },
				synonyms: [`Authentische Bewegung`]
			},
			{
				slug: `primal-movement`,
				get label() { /* @wc-include */ return `Primal Movement`; },
				synonyms: [`Ursprüngliche Bewegung`]
			},
			{
				slug: `somatic-movement`,
				get label() { /* @wc-include */ return `Somatische Bewegung`; },
				synonyms: [`Somatic Movement`, `Somatik`, `Somatic`, `Somatics`, `Somatic Practices`]
			},
			{
				slug: `functional-movement`,
				get label() { /* @wc-include */ return `Funktionale Bewegung`; },
				synonyms: [`Functional Movement`]
			},
			{
				slug: `qigong`,
				get label() { /* @wc-include */ return `Qigong`; },
				synonyms: [`Qi Gong`, `Chi Gong`, `Chi Kung`, `Qi-Gong`]
			},
			{
				slug: `tai-chi`,
				get label() { /* @wc-include */ return `Tai Chi`; },
				synonyms: [`Tai Chi / Tai Ji`, `Tai Ji`, `Taiji`, `Taijiquan`]
			},
			{
				slug: `mobility`,
				get label() { /* @wc-include */ return `Mobilität`; },
				synonyms: [`Mobility`, `Gelenkmobilität`]
			},
			{
				slug: `pilates`,
				get label() { /* @wc-include */ return `Pilates`; }
			},
			{
				slug: `fitness`,
				get label() { /* @wc-include */ return `Fitness`; },
				synonyms: [`Workout`, `Krafttraining`]
			},
			{
				slug: `feldenkrais`,
				get label() { /* @wc-include */ return `Feldenkrais`; },
				synonyms: [`Feldenkrais-Methode`]
			},
			{
				slug: `hiking`,
				get label() { /* @wc-include */ return `Wandern`; },
				synonyms: [`Hiking`, `Wanderung`]
			},
			{
				slug: `martial-arts`,
				get label() { /* @wc-include */ return `Kampfkünste`; },
				synonyms: [`Martial Arts`, `Kampfkunst`, `Kung Fu`, `Karate`, `Capoeira`, `Muay Thai`, `Kickboxing`, `Self-defense`, `Self-Defense`, `Selbstverteidigung`]
			},
			{
				slug: `flow-arts`,
				get label() { /* @wc-include */ return `Flow Arts`; },
				synonyms: [`Flowarts`, `Poi`, `Jonglage`, `Juggling`]
			},
		],
	},
	{
		slug: `energy-work`,
		get label() { return /* @wc-include */ `Energiearbeit`; },
		tags: [
			{
				slug: `reiki`,
				get label() { /* @wc-include */ return `Reiki`; },
				synonyms: [`Usui Reiki`, `Reiki-Heilung`]
			},
			{
				slug: `pranic-healing`,
				get label() { /* @wc-include */ return `Prana-Heilung`; },
				synonyms: [`Pranic Healing`, `Prana Healing`]
			},
			{
				slug: `energy-medicine`,
				get label() { /* @wc-include */ return `Energiemedizin`; },
				synonyms: [`Energy Medicine`]
			},
			{
				slug: `chakra-work`,
				get label() { /* @wc-include */ return `Chakra-Arbeit`; },
				synonyms: [`Chakra Healing`, `Chakraarbeit`]
			},
			{
				slug: `chakras`,
				get label() { /* @wc-include */ return `Chakren`; },
				synonyms: [`Chakra`, `Chakras`]
			},
			{
				slug: `kundalini-activation`,
				get label() { /* @wc-include */ return `Kundalini-Aktivierung`; },
				synonyms: [`Kundalini Activation`, `KAP`]
			},
			{
				slug: `kundalini`,
				get label() { /* @wc-include */ return `Kundalini`; }
			},
			{
				slug: `biofield-healing`,
				get label() { /* @wc-include */ return `Biofeldheilung`; },
				synonyms: [`Biofield Healing`]
			},
			{
				slug: `hands-on-healing`,
				get label() { /* @wc-include */ return `Handauflegen`; },
				synonyms: [`Energy Healing`, `Hands-on Healing`, `Hands-on Energy Healing`]
			},
			{
				slug: `light-language`,
				get label() { /* @wc-include */ return `Lichtsprache`; },
				synonyms: [`Light Language`, `Lichtcodes`]
			},
			{
				slug: `access-bars`,
				get label() { /* @wc-include */ return `Access Bars`; },
				synonyms: [`Access Consciousness`, `Bars`]
			},
		],
	},
	{
		slug: `sound-healing`,
		get label() { return /* @wc-include */ `Sound Healing`; },
		tags: [
			{
				slug: `sound-healing`,
				get label() { /* @wc-include */ return `Sound Healing`; },
				synonyms: [`Klangheilung`, `Soundhealing`]
			},
			{
				slug: `sound-bath`,
				get label() { /* @wc-include */ return `Klangbad`; },
				synonyms: [`Sound Bath`, `Gong-Bad`]
			},
			{
				slug: `sound-journey`,
				get label() { /* @wc-include */ return `Klangreise`; },
				synonyms: [`Sound Journey`, `Bass Journey`]
			},
			{
				slug: `gong`,
				get label() { /* @wc-include */ return `Gong`; },
				synonyms: [`Gongbad`, `Gong Bath`, `Gong Meditation`]
			},
			{
				slug: `singing-bowls`,
				get label() { /* @wc-include */ return `Klangschalen`; },
				synonyms: [`Singing Bowls`, `Klangschale`, `Tibetische Klangschalen`]
			},
		],
	},
	{
		slug: `bodywork`,
		get label() { return /* @wc-include */ `Körperarbeit`; },
		tags: [
			{
				slug: `bodywork`,
				get label() { /* @wc-include */ return `Körperarbeit`; },
				synonyms: [`Bodywork`, `Body Work`, `Reflexology`, `Reflexzonenmassage`]
			},
			{
				slug: `massage`,
				get label() { /* @wc-include */ return `Massage`; },
				synonyms: [`Tantramassage`, `Abdominal Massage`, `Chi Nei Tsang`]
			},
			{
				slug: `healing`,
				get label() { /* @wc-include */ return `Heilung`; },
				synonyms: [`Healing`, `Heilpraktiker`, `Heilerinnen`, `Heiler`, `Heilkunde`]
			},
			{
				slug: `energy-work`,
				get label() { /* @wc-include */ return `Energiearbeit`; },
				synonyms: [`Energy Work`, `Energy Healing`, `Energie`]
			},
			{
				slug: `reiki`,
				get label() { /* @wc-include */ return `Reiki`; }
			},
			{
				slug: `shiatsu`,
				get label() { /* @wc-include */ return `Shiatsu`; }
			},
			{
				slug: `haptonomy`,
				get label() { /* @wc-include */ return `Haptonomie`; },
				synonyms: [`Haptonomy`]
			},
			{
				slug: `touch`,
				get label() { /* @wc-include */ return `Berührung`; },
				synonyms: [`Touch`]
			},
			{
				slug: `cuddle`,
				get label() { /* @wc-include */ return `Kuscheln`; },
				synonyms: [`Cuddle`, `Cuddling`, `Kuschelparty`, `Cuddle Party`, `Cuddle Workshop`, `Cuddle Workshops`, `Kuschelabend`]
			},
			{
				slug: `trauma-release`,
				get label() { /* @wc-include */ return `Traumaauflösung`; },
				synonyms: [`Trauma Release`, `Traumalösung`, `Trauma-Arbeit`, `Traumaarbeit`, `Trauma`]
			},
			{
				slug: `somatic-experiencing`,
				get label() { /* @wc-include */ return `Somatic Experiencing`; },
				synonyms: [`SE`, `Somatisches Erleben`]
			},
			{
				slug: `polyvagal-theory`,
				get label() { /* @wc-include */ return `Polyvagal-Theorie`; },
				synonyms: [`Polyvagal`, `Polyvagal Theory`, `Vagusnerv`]
			},
			{
				slug: `aura-reading`,
				get label() { /* @wc-include */ return `Aura-Lesen`; },
				synonyms: [`Aura Reading`, `Aura-Reading`]
			},
			{
				slug: `chakras`,
				get label() { /* @wc-include */ return `Chakren`; }
			},
			{
				slug: `kundalini`,
				get label() { /* @wc-include */ return `Kundalini`; }
			},
			{
				slug: `kundalini-activation`,
				get label() { /* @wc-include */ return `Kundalini-Aktivierung`; }
			},
			{
				slug: `health`,
				get label() { /* @wc-include */ return `Gesundheit`; },
				synonyms: [`Health`, `Wellbeing`, `Longevity`, `Biohacking`]
			},
			{
				slug: `relaxation`,
				get label() { /* @wc-include */ return `Entspannung`; },
				synonyms: [`Relaxation`, `Wellness`, `Spa`]
			},
			{
				slug: `stress`,
				get label() { /* @wc-include */ return `Stress`; },
				synonyms: [`Burnout`, `Stressabbau`]
			},
			{
				slug: `focusing`,
				get label() { /* @wc-include */ return `Focusing`; }
			},
			{
				slug: `yoni-steam`,
				get label() { /* @wc-include */ return `Yoni-Dampfbad`; },
				synonyms: [`Yoni Steam`, `Yoni Steaming`]
			},
			{
				slug: `womb-healing`,
				get label() { /* @wc-include */ return `Womb Healing`; },
				synonyms: [`Womb Wisdom`, `Gebärmutterheilung`]
			},
			{
				slug: `aromatherapy`,
				get label() { /* @wc-include */ return `Aromatherapie`; },
				synonyms: [`Aromatherapy`]
			},
			{
				slug: `ayurveda`,
				get label() { /* @wc-include */ return `Ayurveda`; }
			},
			{
				slug: `chinese-medicine`,
				get label() { /* @wc-include */ return `Chinesische Medizin`; },
				synonyms: [`Chinese Medicine`, `TCM`, `Acupuncture`, `Akupunktur`]
			},
			{
				slug: `germanic-new-medicine`,
				get label() { /* @wc-include */ return `Germanische Heilkunde`; },
				synonyms: [`Germanic New Medicine`, `Germanische Neue Medizin`]
			},
			{
				slug: `sauna`,
				get label() { /* @wc-include */ return `Sauna`; },
				synonyms: [`Aufguss`]
			},
			{
				slug: `selfcare`,
				get label() { /* @wc-include */ return `Selbstfürsorge`; },
				synonyms: [`Self-care`, `Self Care`, `Selfcare`]
			},
			{
				slug: `body-awareness`,
				get label() { /* @wc-include */ return `Körperbewusstsein`; },
				synonyms: [`Body Awareness`]
			},
			{
				slug: `embodiment`,
				get label() { /* @wc-include */ return `Embodiment`; },
				synonyms: [`Embodyment`, `Verkörperung`]
			},
			{
				slug: `feldenkrais`,
				get label() { /* @wc-include */ return `Feldenkrais`; }
			},
			{
				slug: `nervous-system-regulation`,
				get label() { /* @wc-include */ return `Nervensystem-Regulation`; },
				synonyms: [`Nervous System`, `Nervensystem`, `Nervous System Regulation`]
			},
			{
				slug: `tre`,
				get label() { /* @wc-include */ return `TRE`; },
				synonyms: [`Trauma Release Exercises`, `Tension Release Exercises`]
			},
			{
				slug: `embodied-release`,
				get label() { /* @wc-include */ return `Embodied Release`; }
			},
			{
				slug: `therapeutic-touch`,
				get label() { /* @wc-include */ return `Therapeutische Berührung`; },
				synonyms: [`Therapeutic Touch`]
			},
			{
				slug: `myofascial-release`,
				get label() { /* @wc-include */ return `Myofasziale Entspannung`; },
				synonyms: [`Myofascial Release`, `Faszienarbeit`, `Faszien`]
			},
			{
				slug: `craniosacral-work`,
				get label() { /* @wc-include */ return `Craniosacrale Arbeit`; },
				synonyms: [`Craniosacral`, `Craniosacral Therapy`, `Cranio`]
			},
			{
				slug: `structural-integration`,
				get label() { /* @wc-include */ return `Strukturelle Integration`; },
				synonyms: [`Structural Integration`, `Rolfing`]
			},
			{
				slug: `alexander-technique`,
				get label() { /* @wc-include */ return `Alexander-Technik`; },
				synonyms: [`Alexander Technique`, `Alexandertechnik`]
			},
			{
				slug: `fasting`,
				get label() { /* @wc-include */ return `Fasten`; },
				synonyms: [`Fasting`, `Fastenkur`, `Heilfasten`]
			},
			{
				slug: `forest-bathing`,
				get label() { /* @wc-include */ return `Waldbaden`; },
				synonyms: [`Forest Bathing`, `Forest Bathing (Shinrin Yoku)`, `Waldbaden (Shinrin Yoku)`, `Shinrin Yoku`, `Forest Experience`]
			},
			{
				slug: `herbalism`,
				get label() { /* @wc-include */ return `Kräuterkunde`; },
				synonyms: [`Herbalism`, `Kräuter`, `Herbs`, `Heilpflanzen`]
			},
			{
				slug: `foraging`,
				get label() { /* @wc-include */ return `Wildkräutersammeln`; },
				synonyms: [`Foraging`, `Wildkräuter`, `Wildplücken`, `Kräuterwanderung`]
			},
		],
	},
	{
		slug: `music`,
		get label() { return /* @wc-include */ `Musik`; },
		tags: [
			{
				slug: `music`,
				get label() { /* @wc-include */ return `Musik`; },
				synonyms: [`Music`]
			},
			{
				slug: `mantra-singing`,
				get label() { /* @wc-include */ return `Mantrasingen`; },
				synonyms: [`Mantra Singing`, `Mantra`, `Mantra singen`]
			},
			{
				slug: `kirtan`,
				get label() { /* @wc-include */ return `Kirtan`; },
				synonyms: [`Bhajan`, `Kirtanabend`]
			},
			{
				slug: `singing`,
				get label() { /* @wc-include */ return `Singen`; },
				synonyms: [`Gesang`, `Singing`, `Chor`, `Choir`]
			},
			{
				slug: `drum-circle`,
				get label() { /* @wc-include */ return `Trommelkreis`; },
				synonyms: [`Drum Circle`, `Trommelkreise`, `drum-circles`, `Trommeln`, `Perkussion`]
			},
			{
				slug: `voice-liberation`,
				get label() { /* @wc-include */ return `Stimmbefreiung`; },
				synonyms: [`Voice Liberation`, `Stimm-Befreiung`, `Stimmarbeit`]
			},
			{
				slug: `live-music`,
				get label() { /* @wc-include */ return `Livemusik`; },
				synonyms: [`Live Music`, `Live-Musik`, `Live Band`, `Music Evening`]
			},
			{
				slug: `handpan`,
				get label() { /* @wc-include */ return `Handpan`; },
				synonyms: [`Hang Drum`]
			},
			{
				slug: `performance`,
				get label() { /* @wc-include */ return `Auftritt`; },
				synonyms: [`Performance`, `Show`, `Live Performance`]
			},
			{
				slug: `music-lesson`,
				get label() { /* @wc-include */ return `Musikunterricht`; },
				synonyms: [`Music Lesson`, `Music Class`, `Music Workshop`]
			},
			{
				slug: `lying-concert`,
				get label() { /* @wc-include */ return `Liegekonzert`; },
				synonyms: [`Lying Concert`, `Ligconcert`]
			},
			{
				slug: `singing-circle`,
				get label() { /* @wc-include */ return `Singkreis`; },
				synonyms: [`Singing Circle`, `Singkreise`, `singing-circles`, `Circle Singing`]
			},
			{
				slug: `voice-expression`,
				get label() { /* @wc-include */ return `Stimmausdruck`; },
				synonyms: [`Voice Expression`]
			},
			{
				slug: `music-therapy`,
				get label() { /* @wc-include */ return `Musiktherapie`; },
				synonyms: [`Music Therapy`]
			},
			{
				slug: `sanskrit-mantra-recitation`,
				get label() { /* @wc-include */ return `Sanskrit-Mantra-Rezitation`; },
				synonyms: [`Sanskrit Mantra Recitation`, `Mantrarezitation`]
			},
			{
				slug: `voice-activation`,
				get label() { /* @wc-include */ return `Stimmaktivierung`; },
				synonyms: [`Voice Activation`, `Stimmöffnung`]
			},
			{
				slug: `medicine-music`,
				get label() { /* @wc-include */ return `Medizinmusik`; },
				synonyms: [`Medicine Music`, `Medicine Songs`]
			},
			{
				slug: `ukulele`,
				get label() { /* @wc-include */ return `Ukulele`; }
			},
			{
				slug: `didgeridoo`,
				get label() { /* @wc-include */ return `Didgeridoo`; },
				synonyms: [`Didjeridu`]
			},
			{
				slug: `harp`,
				get label() { /* @wc-include */ return `Harfe`; },
				synonyms: [`Harp`]
			},
			{
				slug: `jam-session`,
				get label() { /* @wc-include */ return `Jam-Session`; },
				synonyms: [`Jam Session`, `Music Jam`, `Jamsession`, `Open Jam`]
			},
			{
				slug: `psy-trance`,
				get label() { /* @wc-include */ return `Psytrance`; },
				synonyms: [`Psy Trance`, `Goa`]
			},
			{
				slug: `concert`,
				get label() { /* @wc-include */ return `Konzert`; },
				synonyms: [`Concert`, `Live-Konzert`]
			},
			{
				slug: `soul-voice`,
				get label() { /* @wc-include */ return `Seelenstimme`; },
				synonyms: [`Soul Voice`]
			},
			{
				slug: `drum-making`,
				get label() { /* @wc-include */ return `Trommelbau`; },
				synonyms: [`Drum Making`]
			},
		],
	},
	{
		slug: `relationship`,
		get label() { return /* @wc-include */ `Beziehung`; },
		tags: [
			{
				slug: `relationship`,
				get label() { /* @wc-include */ return `Beziehung`; },
				synonyms: [`Relationships`, `Beziehungen`]
			},
			{
				slug: `authentic-relating`,
				get label() { /* @wc-include */ return `Authentic Relating`; },
				synonyms: [`Authentisches Relating`, `Circling`]
			},
			{
				slug: `dating`,
				get label() { /* @wc-include */ return `Dating`; },
				synonyms: [`Partnersuche`]
			},
			{
				slug: `open-relationships`,
				get label() { /* @wc-include */ return `Offene Beziehungen`; },
				synonyms: [`Open Relationships`, `Polyamorie`, `Polyamory`, `Offene Beziehung`]
			},
			{
				slug: `nonviolent-communication`,
				get label() { /* @wc-include */ return `Gewaltfreie Kommunikation`; },
				synonyms: [`Nonviolent Communication`, `GFK`, `NVC`, `Conscious Communication`]
			},
			{
				slug: `boundaries`,
				get label() { /* @wc-include */ return `Grenzen & Konsens`; },
				synonyms: [`Boundaries`, `Consent`, `Einvernehmlichkeit`, `Grenzarbeit`, `Konsensarbeit`]
			},
			{
				slug: `connection`,
				get label() { /* @wc-include */ return `Verbindung`; },
				synonyms: [`Connection`]
			},
			{
				slug: `heart-connection`,
				get label() { /* @wc-include */ return `Herzverbindung`; },
				synonyms: [`Heart Connection`]
			},
			{
				slug: `love`,
				get label() { /* @wc-include */ return `Liebe`; },
				synonyms: [`Love`]
			},
			{
				slug: `family`,
				get label() { /* @wc-include */ return `Familie`; },
				synonyms: [`Family`]
			},
			{
				slug: `family-system`,
				get label() { /* @wc-include */ return `Familiensystem`; },
				synonyms: [`Family System`]
			},
			{
				slug: `family-constellations`,
				get label() { /* @wc-include */ return `Familienaufstellung`; },
				synonyms: [`Family Constellations`, `Family Constellation`, `Familienaufstellungen`]
			},
			{
				slug: `conscious-parenting`,
				get label() { /* @wc-include */ return `Bewusste Elternschaft`; },
				synonyms: [`Conscious Parenting`]
			},
			{
				slug: `motherhood`,
				get label() { /* @wc-include */ return `Mutterschaft`; },
				synonyms: [`Motherhood`]
			},
			{
				slug: `fatherhood`,
				get label() { /* @wc-include */ return `Vaterschaft`; },
				synonyms: [`Fatherhood`]
			},
			{
				slug: `parent-child`,
				get label() { /* @wc-include */ return `Eltern-Kind`; },
				synonyms: [`Parent-Child`, `parentchild`]
			},
			{
				slug: `mother-daughter`,
				get label() { /* @wc-include */ return `Mutter-Tochter`; },
				synonyms: [`Mother-Daughter`, `motherdaughter`]
			},
			{
				slug: `father-son`,
				get label() { /* @wc-include */ return `Vater-Sohn`; },
				synonyms: [`Father-Son`, `fatherson`]
			},
			{
				slug: `father-daughter`,
				get label() { /* @wc-include */ return `Vater-Tochter`; },
				synonyms: [`Father-Daughter`, `fatherdaughter`]
			},
			{
				slug: `pregnancy`,
				get label() { /* @wc-include */ return `Schwangerschaft`; },
				synonyms: [`Pregnancy`]
			},
			{
				slug: `postpartum`,
				get label() { /* @wc-include */ return `Wochenbett`; },
				synonyms: [`Postpartum`]
			},
			{
				slug: `mother-circle`,
				get label() { /* @wc-include */ return `Mutterkreis`; },
				synonyms: [`Mother Circle`, `Mütterkreis`]
			},
			{
				slug: `queer`,
				get label() { /* @wc-include */ return `Queer`; },
				synonyms: [`LGBTQ`, `LGBTQIA`]
			},
			{
				slug: `feminine`,
				get label() { /* @wc-include */ return `Weiblichkeit`; },
				synonyms: [`Feminine`, `Feminine Embodiment`, `Divine Feminine`]
			},
			{
				slug: `masculine`,
				get label() { /* @wc-include */ return `Männlichkeit`; },
				synonyms: [`Masculine`, `Sacred Masculine`]
			},
			{
				slug: `sharing-circle`,
				get label() { /* @wc-include */ return `Sharing-Kreis`; },
				synonyms: [`Sharing Circle`, `Council`, `Sharingkreis`]
			},
			{
				slug: `mixed-circle`,
				get label() { /* @wc-include */ return `Gemischter Kreis`; },
				synonyms: [`Mixed Circle`]
			},
			{
				slug: `relationship-constellation`,
				get label() { /* @wc-include */ return `Beziehungsaufstellung`; },
				synonyms: [`Relationship Constellations`, `Beziehungsaufstellungen`]
			},
			{
				slug: `conscious-relationship`,
				get label() { /* @wc-include */ return `Bewusste Beziehung`; },
				synonyms: [`Conscious Relationship`]
			},
			{
				slug: `couples-work`,
				get label() { /* @wc-include */ return `Paararbeit`; },
				synonyms: [`Couples Work`, `Couples`, `Paarworkshop`, `Paartherapie`]
			},
			{
				slug: `attachment`,
				get label() { /* @wc-include */ return `Bindung`; },
				synonyms: [`Attachment`, `Bindungstheorie`, `Attachment Theory`]
			},
			{
				slug: `communication`,
				get label() { /* @wc-include */ return `Kommunikation`; },
				synonyms: [`Communication`]
			},
			{
				slug: `conflict-repair`,
				get label() { /* @wc-include */ return `Konfliktklärung`; },
				synonyms: [`Conflict Repair`, `Konfliktarbeit`, `Mediation`]
			},
			{
				slug: `connection-practice`,
				get label() { /* @wc-include */ return `Verbindungspraxis`; },
				synonyms: [`Connection Practice`]
			},
			{
				slug: `conscious-touch`,
				get label() { /* @wc-include */ return `Bewusste Berührung`; }
			},
			{
				slug: `cuddle`,
				get label() { /* @wc-include */ return `Kuscheln`; },
				synonyms: [`Cuddle`, `Cuddling`, `Kuschelparty`, `Cuddle Party`, `Cuddle Workshop`, `Cuddle Workshops`, `Kuschelabend`]
			},
			{
				slug: `conscious-dating`,
				get label() { /* @wc-include */ return `Achtsames Dating`; },
				synonyms: [`Conscious Dating`]
			},
			{
				slug: `selflove`,
				get label() { /* @wc-include */ return `Selbstliebe`; },
				synonyms: [`Self-Love`, `Self Love`, `Selflove`]
			},
			{
				slug: `gathering`,
				get label() { /* @wc-include */ return `Gathering`; },
				synonyms: [`Community`, `Gemeinschaft`, `Gatherings`, `Begegnung`, `Meetup`, `Meetings`, `Treffen`, `Netzwerk`, `Networking`, `Social Gathering`]
			},
		],
	},
	{
		slug: `personal-growth`,
		get label() { return /* @wc-include */ `Persönliche Entwicklung`; },
		tags: [
			{
				slug: `personal-development`,
				get label() { /* @wc-include */ return `Persönliche Entwicklung`; },
				synonyms: [`Personal Development`, `Innere Arbeit`, `Inner Work`, `Personal Growth`, `Self Growth`, `Self Discovery`, `Self-Awareness`, `Persönlichkeitsentwicklung`, `Transformation`]
			},
			{
				slug: `personal-leadership`,
				get label() { /* @wc-include */ return `Selbstführung`; },
				synonyms: [`Personal Leadership`, `Persönliche Führung`]
			},
			{
				slug: `entrepreneurship`,
				get label() { /* @wc-include */ return `Unternehmertum`; },
				synonyms: [`Entrepreneurship`]
			},
			{
				slug: `yoga`,
				get label() { /* @wc-include */ return `Yoga`; },
				synonyms: [`Ashtanga`, `Hatha Yoga`, `Vinyasa Yoga`, `Yin Yoga`, `Iyengar Yoga`, `Bhakti Yoga`, `Water Yoga`, `Couple Yoga`, `Somatic Yin Yoga`, `Yogic Philosophy`]
			},
			{
				slug: `acro-yoga`,
				get label() { /* @wc-include */ return `Acro Yoga`; }
			},
			{
				slug: `kundalini-yoga`,
				get label() { /* @wc-include */ return `Kundalini Yoga`; },
				synonyms: [`Kundaliniyoga`]
			},
			{
				slug: `childrens-workshop`,
				get label() { /* @wc-include */ return `Kinderworkshop`; },
				synonyms: [`Children's Workshop`, `Kinder Workshop`]
			},
			{
				slug: `sup-yoga`,
				get label() { /* @wc-include */ return `SUP-Yoga`; },
				synonyms: [`SUP Yoga`, `Stand Up Paddle Yoga`]
			},
			{
				slug: `aerial-yoga`,
				get label() { /* @wc-include */ return `Aerial Yoga`; },
				synonyms: [`Luftyoga`, `Yoga Swing`]
			},
			{
				slug: `therapy`,
				get label() { /* @wc-include */ return `Therapie`; },
				synonyms: [`Therapy`]
			},
			{
				slug: `psychology`,
				get label() { /* @wc-include */ return `Psychologie`; },
				synonyms: [`Psychology`]
			},
			{
				slug: `inner-child`,
				get label() { /* @wc-include */ return `Inneres Kind`; },
				synonyms: [`Inner Child`, `Innere-Kind-Arbeit`]
			},
			{
				slug: `shadow-work`,
				get label() { /* @wc-include */ return `Schattenarbeit`; },
				synonyms: [`Shadow Work`]
			},
			{
				slug: `anger-work`,
				get label() { /* @wc-include */ return `Wutarbeit`; },
				synonyms: [`Anger Work`, `Wutausdruck`]
			},
			{
				slug: `mens-workshop`,
				get label() { /* @wc-include */ return `Männer-Workshop`; },
				synonyms: [`Men's Workshop`, `Men's Workshops`, `Männerworkshop`]
			},
			{
				slug: `womens-workshop`,
				get label() { /* @wc-include */ return `Frauen-Workshop`; },
				synonyms: [`Women's Workshop`, `Women's Workshops`, `Frauenworkshop`, `Womens Empowerment`]
			},
			{
				slug: `mens-circle`,
				get label() { /* @wc-include */ return `Männerkreis`; },
				synonyms: [`Men's Circle`, `Men's Circles`]
			},
			{
				slug: `womens-circle`,
				get label() { /* @wc-include */ return `Frauenkreis`; },
				synonyms: [`Women Circle`, `Women's Circles`, `Women’s Circle`, `Women's Circle`]
			},
			{
				slug: `hypnosis`,
				get label() { /* @wc-include */ return `Hypnose`; },
				synonyms: [`Hypnosis`, `Hypnotherapy`, `Hypnotherapie`]
			},
			{
				slug: `constellations`,
				get label() { /* @wc-include */ return `Aufstellungen`; },
				synonyms: [`Constellations`, `Systemische Aufstellung`]
			},
			{
				slug: `organizational-constellations`,
				get label() { /* @wc-include */ return `Organisationsaufstellungen`; },
				synonyms: [`Organizational Constellations`]
			},
			{
				slug: `systemic-work`,
				get label() { /* @wc-include */ return `Systemische Arbeit`; },
				synonyms: [`Systemic Work`]
			},
			{
				slug: `knowledge`,
				get label() { /* @wc-include */ return `Wissen`; },
				synonyms: [`Knowledge`]
			},
			{
				slug: `work-and-career`,
				get label() { /* @wc-include */ return `Arbeit und Karriere`; },
				synonyms: [`Work and Career`]
			},
			{
				slug: `emotion-coaching`,
				get label() { /* @wc-include */ return `Emotionscoaching`; },
				synonyms: [`Emotion Coaching`, `Emotionsarbeit`, `Emotional Health`, `Emotional Release`, `Emotional Balance`]
			},
			{
				slug: `laughter-workshop`,
				get label() { /* @wc-include */ return `Lachworkshop`; },
				synonyms: [`Laughter Workshop`, `Lachyoga`, `Laughter Yoga`]
			},
			{
				slug: `selflove`,
				get label() { /* @wc-include */ return `Selbstliebe`; }
			},
			{
				slug: `selfexpression`,
				get label() { /* @wc-include */ return `Selbstausdruck`; },
				synonyms: [`Self-Expression`, `Self Expression`]
			},
			{
				slug: `creativity`,
				get label() { /* @wc-include */ return `Kreativität`; },
				synonyms: [`Creativity`]
			},
			{
				slug: `playfulness`,
				get label() { /* @wc-include */ return `Verspieltheit`; },
				synonyms: [`Playfulness`]
			},
			{
				slug: `gifted`,
				get label() { /* @wc-include */ return `Hochbegabung`; },
				synonyms: [`Gifted`, `Hochbegabt`]
			},
			{
				slug: `highly-sensitive`,
				get label() { /* @wc-include */ return `Hochsensibelität`; },
				synonyms: [`Highly Sensitive`, `HSP (Hochsensible Person)`, `HSP`, `Hochsensible Person`, `hsp-highly-sensitive-person`]
			},
			{
				slug: `addiction`,
				get label() { /* @wc-include */ return `Sucht`; },
				synonyms: [`Addiction`]
			},
			{
				slug: `psychiatric-labels`,
				get label() { /* @wc-include */ return `Psychiatrische Diagnosen`; },
				synonyms: [`Psychiatric Labels`, `Psychische Labels`]
			},
			{
				slug: `grief-and-loss`,
				get label() { /* @wc-include */ return `Trauer und Verlust`; },
				synonyms: [`Grief and Loss`, `Trauerbegleitung`, `Trauer`]
			},
			{
				slug: `menopause`,
				get label() { /* @wc-include */ return `Menopause / Wechseljahre`; },
				synonyms: [`Menopause`, `Wechseljahre`]
			},
			{
				slug: `vanishing-twin`,
				get label() { /* @wc-include */ return `Alleingeborener Zwilling`; },
				synonyms: [`Vanishing Twin`]
			},
			{
				slug: `talent-game`,
				get label() { /* @wc-include */ return `Talentspiel`; },
				synonyms: [`Talent Game`, `Talentenspiel`]
			},
			{
				slug: `creative-arts-therapy`,
				get label() { /* @wc-include */ return `Kreativtherapie`; },
				synonyms: [`Creative Arts Therapy`, `Art Therapy`, `Kunsttherapie`]
			},
			{
				slug: `drama-therapy`,
				get label() { /* @wc-include */ return `Dramatherapie`; },
				synonyms: [`Drama Therapy`]
			},
			{
				slug: `writing`,
				get label() { /* @wc-include */ return `Schreiben`; },
				synonyms: [`Writing`, `Journaling`, `Kreatives Schreiben`]
			},
			{
				slug: `art`,
				get label() { /* @wc-include */ return `Kunst`; },
				synonyms: [`Art`, `Malen`]
			},
			{
				slug: `intuitive-painting`,
				get label() { /* @wc-include */ return `Intuitives Malen`; },
				synonyms: [`Intuitive Painting`]
			},
			{
				slug: `cocreation`,
				get label() { /* @wc-include */ return `Co-Kreation`; },
				synonyms: [`Co-creation`, `Co-Creation`]
			},
			{
				slug: `the-inner-voice`,
				get label() { /* @wc-include */ return `Die innere Stimme`; },
				synonyms: [`The Inner Voice`, `Inner Voice`, `Die Stimme von innen`]
			},
			{
				slug: `collective-evolution`,
				get label() { /* @wc-include */ return `Kollektive Evolution`; },
				synonyms: [`Collective Evolution`]
			},
			{
				slug: `consciousness-development`,
				get label() { /* @wc-include */ return `Bewusstseinsentwicklung`; },
				synonyms: [`Consciousness Development`, `Consciousness`, `Conscious Living`]
			},
			{
				slug: `purpose-life-direction`,
				get label() { /* @wc-include */ return `Lebenssinn / Ausrichtung`; },
				synonyms: [`Purpose`, `Lebenssinn`, `Berufung`]
			},
			{
				slug: `mindset`,
				get label() { /* @wc-include */ return `Mindset`; },
				synonyms: [`Denkmuster`]
			},
			{
				slug: `confidence-selfesteem`,
				get label() { /* @wc-include */ return `Selbstvertrauen`; },
				synonyms: [`Confidence`, `Self-Esteem`, `Selbstbewusstsein`, `Selbstwirksamkeit`, `Selbstwert`]
			},
			{
				slug: `emotional-intelligence`,
				get label() { /* @wc-include */ return `Emotionale Intelligenz`; },
				synonyms: [`Emotional Intelligence`, `EQ`]
			},
			{
				slug: `parts-work`,
				get label() { /* @wc-include */ return `Teilearbeit`; },
				synonyms: [`Parts Work`, `IFS`, `Internal Family Systems`]
			},
			{
				slug: `belief-pattern-transformation`,
				get label() { /* @wc-include */ return `Glaubenssatzarbeit`; },
				synonyms: [`Belief Work`, `Glaubenssätze`, `Limiting Beliefs`]
			},
			{
				slug: `intuition`,
				get label() { /* @wc-include */ return `Intuition`; }
			},
			{
				slug: `family-constellations`,
				get label() { /* @wc-include */ return `Familienaufstellung`; }
			},
			{
				slug: `systemic-constellations`,
				get label() { /* @wc-include */ return `Systemische Aufstellungen`; },
				synonyms: [`Systemic Constellations`]
			},
			{
				slug: `regression`,
				get label() { /* @wc-include */ return `Regression`; },
				synonyms: [`Regressionstherapie`]
			},
			{
				slug: `pastlife-exploration`,
				get label() { /* @wc-include */ return `Erforschung früherer Leben`; },
				synonyms: [`Past Life Exploration`, `Frühere Leben`]
			},
			{
				slug: `past-life-regression`,
				get label() { /* @wc-include */ return `Rückführung in frühere Leben`; },
				synonyms: [`Past Life Regression`, `Rückführung`]
			},
			{
				slug: `theatre`,
				get label() { /* @wc-include */ return `Theater`; },
				synonyms: [`Theatre`, `Clowning`, `Clown`, `Clownerie`, `Kampftheater`]
			},
			{
				slug: `storytelling`,
				get label() { /* @wc-include */ return `Storytelling`; },
				synonyms: [`Geschichten erzählen`]
			},
			{
				slug: `poetry`,
				get label() { /* @wc-include */ return `Poesie`; },
				synonyms: [`Poetry`, `Lyrik`, `Poetry Slam`]
			},
		],
	},
	{
		slug: `spirituality`,
		get label() { return /* @wc-include */ `Spiritualität`; },
		tags: [
			{
				slug: `shamanism`,
				get label() { /* @wc-include */ return `Schamanismus`; },
				synonyms: [`Shamanism`, `Schamanisch`, `Shamanic`, `Krafttier`]
			},
			{
				slug: `spirituality`,
				get label() { /* @wc-include */ return `Spiritualität`; },
				synonyms: [`Spiritual`, `Spiritual Guidance`, `Spiritual Growth`, `Spiritual Wisdom Talks`]
			},
			{
				slug: `lightwork`,
				get label() { /* @wc-include */ return `Lichtarbeit`; },
				synonyms: [`Lightwork`, `Light Work`]
			},
			{
				slug: `astrology`,
				get label() { /* @wc-include */ return `Astrologie`; },
				synonyms: [`Astrology`, `Horoskop`]
			},
			{
				slug: `human-design`,
				get label() { /* @wc-include */ return `Human Design`; }
			},
			{
				slug: `gene-keys`,
				get label() { /* @wc-include */ return `Gene Keys`; },
				synonyms: [`Gen Keys`]
			},
			{
				slug: `channeling`,
				get label() { /* @wc-include */ return `Channeling`; },
				synonyms: [`Channeln`]
			},
			{
				slug: `mediumship`,
				get label() { /* @wc-include */ return `Medialität`; },
				synonyms: [`Mediumship`, `Medium`]
			},
			{
				slug: `tarot`,
				get label() { /* @wc-include */ return `Tarot`; },
				synonyms: [`Tarotkarten legen`, `Tarotlegen`]
			},
			{
				slug: `card-readings`,
				get label() { /* @wc-include */ return `Kartenlegungen`; },
				synonyms: [`Card Readings`, `Kartenlegung`, `card-reading`, `Oracle Cards`, `Orakelkarten`]
			},
			{
				slug: `nonduality`,
				get label() { /* @wc-include */ return `Nondualität`; },
				synonyms: [`Nonduality`, `Non-Dualität`, `Non Duality`]
			},
			{
				slug: `soul-connection`,
				get label() { /* @wc-include */ return `Seelenverbindung`; },
				synonyms: [`Soul Connection`]
			},
			{
				slug: `new-earth`,
				get label() { /* @wc-include */ return `Neue Erde`; },
				synonyms: [`New Earth`]
			},
			{
				slug: `manifestation`,
				get label() { /* @wc-include */ return `Manifestieren`; },
				synonyms: [`Manifestation`]
			},
			{
				slug: `quantum-jumping`,
				get label() { /* @wc-include */ return `Quantum Jumping`; }
			},
			{
				slug: `law-of-attraction`,
				get label() { /* @wc-include */ return `Gesetz der Anziehung`; },
				synonyms: [`Law of Attraction`]
			},
			{
				slug: `meet-your-guides`,
				get label() { /* @wc-include */ return `Triff deine Guides`; },
				synonyms: [`Meet Your Guides`, `Spirit Guides`]
			},
			{
				slug: `tzolkin-maya-calendar`,
				get label() { /* @wc-include */ return `Tzolkin / Maya-Kalender`; },
				synonyms: [`Tzolkin`, `Maya Calendar`, `Mayakalender`]
			},
			{
				slug: `sufism`,
				get label() { /* @wc-include */ return `Sufismus`; },
				synonyms: [`Sufism`, `Sufi`]
			},
			{
				slug: `taoism`,
				get label() { /* @wc-include */ return `Taoismus`; },
				synonyms: [`Taoism`, `Tao`, `Dao`, `Daoismus`]
			},
			{
				slug: `alchemy`,
				get label() { /* @wc-include */ return `Alchemie`; },
				synonyms: [`Alchemy`]
			},
			{
				slug: `a-course-in-miracles`,
				get label() { /* @wc-include */ return `Ein Kurs in Wundern`; },
				synonyms: [`A Course in Miracles`, `ACIM`, `EKIW`]
			},
			{
				slug: `pendulum-dowsing`,
				get label() { /* @wc-include */ return `Pendeln`; },
				synonyms: [`Pendulum Dowsing`, `Pendulum`, `Radiästhesie`]
			},
			{
				slug: `medicine-wheel`,
				get label() { /* @wc-include */ return `Medizinrad`; },
				synonyms: [`Medicine Wheel`]
			},
			{
				slug: `power-place`,
				get label() { /* @wc-include */ return `Kraftort`; },
				synonyms: [`Power Place`, `Kraftplatz`]
			},
			{
				slug: `labyrinth`,
				get label() { /* @wc-include */ return `Labyrinth`; }
			},
			{
				slug: `cosmic-contact`,
				get label() { /* @wc-include */ return `Kosmischer Kontakt`; },
				synonyms: [`Cosmic Contact`]
			},
			{
				slug: `multidimensionality`,
				get label() { /* @wc-include */ return `Multidimensionalität`; },
				synonyms: [`Multidimensionality`]
			},
			{
				slug: `multidimensional-embodiment-transmission`,
				get label() { /* @wc-include */ return `Multidimensionale Embodiment-Transmission`; },
				synonyms: [`Multidimensional Embodiment Transmission`]
			},
			{
				slug: `numerology`,
				get label() { /* @wc-include */ return `Numerologie`; },
				synonyms: [`Numerology`]
			},
			{
				slug: `gemstones`,
				get label() { /* @wc-include */ return `Edelsteine`; },
				synonyms: [`Gemstones`, `Kristalle`]
			},
			{
				slug: `feng-shui`,
				get label() { /* @wc-include */ return `Feng Shui`; }
			},
			{
				slug: `dreams`,
				get label() { /* @wc-include */ return `Träume`; },
				synonyms: [`Dreams`, `Traumarbeit`, `Traumdeutung`, `Klartraum`, `Lucid Dreaming`]
			},
			{
				slug: `universal-oneness`,
				get label() { /* @wc-include */ return `Universelle Einheit`; },
				synonyms: [`Universal Oneness`]
			},
			{
				slug: `soul-happiness`,
				get label() { /* @wc-include */ return `Seelenglück`; },
				synonyms: [`Soul Happiness`]
			},
			{
				slug: `soul-mission`,
				get label() { /* @wc-include */ return `Seelenmission`; },
				synonyms: [`Soul Mission`, `Seelenauftrag`]
			},
			{
				slug: `mother-earth`,
				get label() { /* @wc-include */ return `Mutter Erde`; },
				synonyms: [`Mother Earth`, `Gaia`, `Pachamama`]
			},
			{
				slug: `past-life-regression`,
				get label() { /* @wc-include */ return `Rückführung in frühere Leben`; }
			},
			{
				slug: `intuition`,
				get label() { /* @wc-include */ return `Intuition`; }
			},
			{
				slug: `osho`,
				get label() { /* @wc-include */ return `Osho`; }
			},
			{
				slug: `light-language`,
				get label() { /* @wc-include */ return `Lichtsprache`; }
			},
			{
				slug: `shamanic-dance`,
				get label() { /* @wc-include */ return `Schamanischer Tanz`; }
			},
			{
				slug: `spiritual-awakening`,
				get label() { /* @wc-include */ return `Spirituelles Erwachen`; },
				synonyms: [`Spiritual Awakening`, `Erwachen`]
			},
			{
				slug: `consciousness-exploration`,
				get label() { /* @wc-include */ return `Bewusstseinserkundung`; },
				synonyms: [`Consciousness Exploration`, `Bewusstseinserweiterung`]
			},
			{
				slug: `mysticism`,
				get label() { /* @wc-include */ return `Mystik`; },
				synonyms: [`Mysticism`]
			},
			{
				slug: `satsang`,
				get label() { /* @wc-include */ return `Satsang`; }
			},
			{
				slug: `spiritual-teachings`,
				get label() { /* @wc-include */ return `Spirituelle Lehren`; },
				synonyms: [`Spiritual Teachings`]
			},
			{
				slug: `advaita`,
				get label() { /* @wc-include */ return `Advaita`; },
				synonyms: [`Advaita Vedanta`, `Vedanta`]
			},
			{
				slug: `buddhist-teachings`,
				get label() { /* @wc-include */ return `Buddhistische Lehren`; },
				synonyms: [`Buddhist Teachings`, `Buddhism`, `Buddhismus`, `Dharma`]
			},
			{
				slug: `devotional-practices`,
				get label() { /* @wc-include */ return `Devotionale Praxis`; },
				synonyms: [`Devotional Practices`, `Bhakti`, `Prayer`, `Gebet`]
			},
			{
				slug: `enneagram`,
				get label() { /* @wc-include */ return `Enneagramm`; },
				synonyms: [`Enneagram`]
			},
			{
				slug: `i-ching`,
				get label() { /* @wc-include */ return `I Ging`; },
				synonyms: [`I Ching`, `Yijing`, `Buch der Wandlungen`]
			},
			{
				slug: `archetypal-work`,
				get label() { /* @wc-include */ return `Archetypenarbeit`; },
				synonyms: [`Archetypal Work`, `Archetypen`]
			},
			{
				slug: `philosophy`,
				get label() { /* @wc-include */ return `Philosophie`; },
				synonyms: [`Philosophy`]
			},
			{
				slug: `witchcraft`,
				get label() { /* @wc-include */ return `Hexerei`; },
				synonyms: [`Witchcraft`, `Witch`, `Hexen`, `Wicca`]
			},
			{
				slug: `mythology`,
				get label() { /* @wc-include */ return `Mythologie`; },
				synonyms: [`Mythology`, `Mythen`]
			},
		],
	},
	{
		slug: `ceremony`,
		get label() { return /* @wc-include */ `Zeremonie`; },
		tags: [
			{
				slug: `sweat-lodge`,
				get label() { /* @wc-include */ return `Schwitzhütte`; },
				synonyms: [`Sweat Lodge`, `Sweatlodge`, `Inipi`]
			},
			{
				slug: `ceremony`,
				get label() { /* @wc-include */ return `Zeremonie`; },
				synonyms: [`Ceremony`]
			},
			{
				slug: `cacao-ceremony`,
				get label() { /* @wc-include */ return `Kakaozeremonie`; },
				synonyms: [`Cacao Ceremony`, `Cacao`, `Kakao`, `Ceremonial Cacao`, `Ritualkakao`]
			},
			{
				slug: `initiations`,
				get label() { /* @wc-include */ return `Einweihungen`; },
				synonyms: [`Initiation`, `Initiations`]
			},
			{
				slug: `plant-medicine`,
				get label() { /* @wc-include */ return `Pflanzenmedizin`; },
				synonyms: [`Plant Medicine`, `Microdosing`, `Psychedelic Experience`, `Ayahuasca`]
			},
			{
				slug: `ritual`,
				get label() { /* @wc-include */ return `Ritual`; },
				synonyms: [`Shamanic Ritual`, `Ritualarbeit`]
			},
			{
				slug: `breath-circle`,
				get label() { /* @wc-include */ return `Atemkreis`; }
			},
			{
				slug: `detox`,
				get label() { /* @wc-include */ return `Detox`; },
				synonyms: [`Entgiftung`]
			},
			{
				slug: `truffle-ceremony`,
				get label() { /* @wc-include */ return `Trüffelzeremonie`; },
				synonyms: [`Truffle Ceremony`, `Zaubertrüffel`]
			},
			{
				slug: `water-ceremony`,
				get label() { /* @wc-include */ return `Wasserzeremonie`; },
				synonyms: [`Water Ceremony`]
			},
			{
				slug: `fire-ceremony`,
				get label() { /* @wc-include */ return `Feuerzeremonie`; },
				synonyms: [`Fire Ceremony`, `Feuerritual`, `Fire Circle`]
			},
			{
				slug: `vision-quest`,
				get label() { /* @wc-include */ return `Visionssuche`; },
				synonyms: [`Vision Quest`]
			},
			{
				slug: `kambo`,
				get label() { /* @wc-include */ return `Kambo`; },
				synonyms: [`Kambô`, `Kambo Ceremony`]
			},
			{
				slug: `new-moon`,
				get label() { /* @wc-include */ return `Neumond`; },
				synonyms: [`New Moon`, `Neumondzeremonie`, `new-moon-ceremony`, `Neumondritual`]
			},
			{
				slug: `full-moon`,
				get label() { /* @wc-include */ return `Vollmond`; },
				synonyms: [`Full Moon`, `Vollmondzeremonie`, `full-moon-ceremony`, `Vollmondritual`]
			},
			{
				slug: `hape`,
				get label() { /* @wc-include */ return `Rapé`; },
				synonyms: [`Hapé`, `Rapeh`, `Hapeh`]
			},
			{
				slug: `inner-journey`,
				get label() { /* @wc-include */ return `Innere Reise`; },
				synonyms: [`Inner Journey`]
			},
			{
				slug: `tea-ceremony`,
				get label() { /* @wc-include */ return `Teezeremonie`; },
				synonyms: [`Tea Ceremony`, `Cha Dao`]
			},
			{
				slug: `rite-of-the-womb`,
				get label() { /* @wc-include */ return `Rite of the Womb`; },
				synonyms: [`Munay Ki`]
			},
			{
				slug: `medicine-walk`,
				get label() { /* @wc-include */ return `Medizinwanderung`; },
				synonyms: [`Medicine Walk`, `Medizinspaziergang`]
			},
			{
				slug: `firewalk`,
				get label() { /* @wc-include */ return `Feuerlauf`; },
				synonyms: [`Firewalk`, `Firewalking`]
			},
			{
				slug: `trance-journey`,
				get label() { /* @wc-include */ return `Trancereise`; },
				synonyms: [`Trance Journey`, `Trance`]
			},
			{
				slug: `blue-lotus`,
				get label() { /* @wc-include */ return `Blauer Lotus`; },
				synonyms: [`Blue Lotus`, `Blaue Lotus`]
			},
			{
				slug: `rites-of-passage`,
				get label() { /* @wc-include */ return `Übergangsriten`; },
				synonyms: [`Rites of Passage`, `Riten des Übergangs`]
			},
			{
				slug: `soul-retrieval`,
				get label() { /* @wc-include */ return `Seelenrückholung`; },
				synonyms: [`Soul Retrieval`]
			},
			{
				slug: `celtic-year-festivals`,
				get label() { /* @wc-include */ return `Keltische Jahresfeste`; },
				synonyms: [`Rauhnächte`, `Jahreskreis`, `Wheel of the Year`, `Samhain`, `Beltane`]
			},
			{
				slug: `womb-healing`,
				get label() { /* @wc-include */ return `Womb Healing`; }
			},
			{
				slug: `despacho-ceremony`,
				get label() { /* @wc-include */ return `Despacho-Zeremonie`; },
				synonyms: [`Despacho Ceremony`, `Despacho`]
			},
			{
				slug: `temazcal`,
				get label() { /* @wc-include */ return `Temazcal`; },
				synonyms: [`Temazcalli`]
			},
			{
				slug: `shamanic-journey`,
				get label() { /* @wc-include */ return `Schamanische Reise`; },
				synonyms: [`Shamanic Journey`, `Trommelreise`]
			},
			{
				slug: `ancestral-healing`,
				get label() { /* @wc-include */ return `Ahnenheilung`; },
				synonyms: [`Ancestral Healing`, `Ahnenarbeit`, `Ahnen`]
			},
			{
				slug: `womb-ritual`,
				get label() { /* @wc-include */ return `Womb-Ritual`; },
				synonyms: [`Womb Ritual`]
			},
			{
				slug: `equinox-solstice`,
				get label() { /* @wc-include */ return `Tagundnachtgleiche/Sonnenwende`; },
				synonyms: [`Equinox`, `Solstice`, `Sonnenwende`, `Tagundnachtgleiche`, `Equinox/Solstice`, `equinoxsolstice`]
			},
		],
	},
	{
		slug: OTHERS_CATEGORY_SLUG,
		get label() { return /* @wc-include */ `Sonstiges`; },
		tags: [
			{
				slug: `nature`,
				get label() { /* @wc-include */ return `Natur`; },
				synonyms: [`Nature`, `Nature Trip`, `Outdoor`, `Camping`, `Bushcraft`]
			},
			{
				slug: `film`,
				get label() { /* @wc-include */ return `Film`; },
				synonyms: [`Kino`, `Filmabend`]
			},
			{
				slug: `cabaret`,
				get label() { /* @wc-include */ return `Kabarett`; },
				synonyms: [`Cabaret`]
			},
			{
				slug: `selfsufficient-living`,
				get label() { /* @wc-include */ return `Autarkes Leben`; },
				synonyms: [`Self-Sufficient Living`, `Permaculture`, `Permakultur`]
			},
			{
				slug: `animals`,
				get label() { /* @wc-include */ return `Tiere`; },
				synonyms: [`Animals`, `Horses`, `Pferde`]
			},
			{
				slug: `fair`,
				get label() { /* @wc-include */ return `Messe`; },
				synonyms: [`Fair`, `Market`, `Markt`, `Art Market`]
			},
			{
				slug: `cooking`,
				get label() { /* @wc-include */ return `Kochen`; },
				synonyms: [`Cooking`, `Cooking Class`, `Kochkurs`, `Food`, `Food & Drink`]
			},
			{
				slug: `sailing`,
				get label() { /* @wc-include */ return `Segeln`; },
				synonyms: [`Sailing`]
			},
			{
				slug: `surfing`,
				get label() { /* @wc-include */ return `Surfen`; },
				synonyms: [`Surfing`]
			},
			{
				slug: `crafts`,
				get label() { /* @wc-include */ return `Handwerk & DIY`; },
				synonyms: [`Make Something Yourself`, `Handwerk`, `Basteln`, `Jewelry Making`, `Schmuck herstellen`, `Pottery & Clay`, `Töpfern`, `Handcraft`, `Candle Making`]
			},
			{
				slug: `creative-expression`,
				get label() { /* @wc-include */ return `Kreativer Ausdruck`; },
				synonyms: [`Creative Expression`]
			},
			{
				slug: `new-years-eve`,
				get label() { /* @wc-include */ return `Silvester`; },
				synonyms: [`New Year's Eve`, `Sylvester`]
			},
			{
				slug: `christmas`,
				get label() { /* @wc-include */ return `Weihnachten`; },
				synonyms: [`Christmas`]
			},
		],
	},
];

/* possible future categories:
  Kreativität & Ausdruck: art, writing, theatre, storytelling, poetry, intuitive-painting, crafts, creative-expression, cabaret, film.
  Natur & Gesundheit: nature, hiking, forest-bathing, foraging, herbalism, fasting, ayurveda, chinese-medicine, sauna, ice-bath.
*/

export const eventFormats: EventTag[] = [
	{
		slug: `festival`,
		get label() { /* @wc-include */ return `Festival`; },
		synonyms: [`Festivals`, `Dance Festival`, `Wellness Festival`],
	},
	{
		slug: `retreat`,
		get label() { /* @wc-include */ return `Retreat`; },
		synonyms: [`Multi-day Retreat`, `Multi-day Retreats`, `Mehrtägiges Retreat`, `1-Day Retreat`, `1-Tages-Retreat`, `3-Day Retreat`, `Silent Retreat`, `Schweigeretreat`, `1-on-1 Retreat`, `1-zu-1-Retreat`, `Mini Retreat in Nature`, `Mini-Retreat in der Natur`, `Wildnis-Retreat`, `DanceRetreat`, `Urlaubsseminar`]
	},
	{
		slug: `course`,
		get label() { /* @wc-include */ return `Kurs`; },
		synonyms: [`Course`, `Ausbildungskurs`, `Class`]
	},
	{
		slug: `lecture`,
		get label() { /* @wc-include */ return `Vortrag`; },
		synonyms: [`Lecture`, `Talk`, `Presentation`, `Präsentation`, `Book Presentation`, `Buchpräsentation`, `Experiential Lecture`, `Experiential Lectures`, `Erlebnisvorträge`]
	},
	{
		slug: `year-program`,
		get label() { /* @wc-include */ return `Jahrestraining`; },
		synonyms: [`Year Program`, `Jahresausbildung`, `Jahrestraining`]
	},
	{
		slug: `program`,
		get label() { /* @wc-include */ return `Programm`; },
		synonyms: [`Program`]
	},
	{
		slug: `workshop`,
		get label() { /* @wc-include */ return `Workshop`; },
		synonyms: [`Workshops`, `Creative Workshop`, `Immersive Workshop`, `Seminar`, `Mehrtägiges Seminar`, `Tagesseminar`]
	},
	{
		slug: `conference`,
		get label() { /* @wc-include */ return `Kongress`; },
		synonyms: [`Conference`, `Congress`, `Tagung`, `Fachtag`]
	},
	{
		slug: `online`,
		get label() { /* @wc-include */ return `Online`; },
		synonyms: [`Zoom`, `Webinar`, `Online-Vortrag`]
	},
];



export const eventCategorySlugs = new Set(eventCategories.map((category) => category.slug));

export function getAssignedTagSlugs() {
	const slugs = new Set<string>();
	for (const category of eventCategories) {
		if (category.slug === OTHERS_CATEGORY_SLUG) continue;
		for (const tag of category.tags) slugs.add(tag.slug);
	}
	return slugs;
}

export function getTagSlugsForCategories(categorySlugs: string[]) {
	const slugs = new Set<string>();
	for (const categorySlug of categorySlugs) {
		if (categorySlug === OTHERS_CATEGORY_SLUG) continue;
		const category = eventCategories.find((item) => item.slug === categorySlug);
		if (!category?.tags?.length) continue;
		for (const tag of category.tags) slugs.add(tag.slug);
	}
	return [...slugs];
}

export function eventMatchesOthersCategory(tags?: string[] | null) {
	if (!tags?.length) return true;
	const assigned = getAssignedTagSlugs();
	return tags.some((slug) => !assigned.has(slug));
}

type EventTag = {
	slug: string;
	get label(): string;
	synonyms?: string[];
};

type EventCategory = {
	slug: string;
	label: string;
	tags: EventTag[];
};

export const allTags = new Set(uniqueTagsBySlug([...eventCategories.flatMap((category) => category.tags), ...eventFormats]));
export const allTagsBySlug = new Map([...allTags].map((tag) => [tag.slug, tag]));
export const allTagSlugs = new Set(allTagsBySlug.keys());
const synonymLookup = buildSynonymLookup();	

/**
 * Catalog slugs whose slug, label, or synonym matches the search word as a whole word, prefix, or suffix.
 *
 * @example
 * getTagSlugsMatchingSearch(`Atemarbeit`)
 */
export function getTagSlugsMatchingSearch(word: string) {
	const needle = word.trim();
	if (!needle) return [];
	const slugs: string[] = [];
	for (const tag of allTags) {
		if (matchesWholeWord(tag.slug, needle) || matchesWholeWord(tag.label, needle)) {
			slugs.push(tag.slug);
			continue;
		}
		if (tag.synonyms?.some((synonym) => matchesWholeWord(synonym, needle))) {
			slugs.push(tag.slug);
		}
	}
	return slugs;
}

export function labelsForTagSlugs(slugs?: string[] | null) {
	if (!slugs?.length) return [];
	return slugs.map((slug) => allTagsBySlug.get(slug)?.label ?? slug);
}

export function knownTagSlugs(slugs?: string[] | null) {
	if (!slugs?.length) return [];
	const result: string[] = [];
	const seen = new Set<string>();
	const unknown: string[] = [];
	for (const slug of slugs) {
		const resolved = slugsForTagInput(slug);
		if (!resolved.length) {
			unknown.push(slug);
			continue;
		}
		for (const canonical of resolved) {
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			result.push(canonical);
		}
	}
	if (unknown.length) console.warn(`unknown tag slugs:`, unknown);
	return result;
}

/**
 * Resolves a catalog slug, label, or synonym to canonical tag slugs.
 */
export function slugsForTagInput(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return [];

	for (const key of lookupKeys(trimmed)) {
		if (allTagSlugs.has(key)) return [key];
	}
	for (const key of lookupKeys(trimmed)) {
		const aliased = synonymLookup.get(key);
		if (aliased?.length) return aliased;
	}
	return [];
}

function uniqueTagsBySlug(tags: EventTag[]) {
	const bySlug = new Map<string, EventTag>();
	for (const tag of tags) {
		if (bySlug.has(tag.slug)) continue;
		bySlug.set(tag.slug, tag);
	}
	return [...bySlug.values()];
}

function buildSynonymLookup() {
	const aliases = new Map<string, string[]>();
	for (const tag of allTags) {
		addLookup(aliases, tag.label, tag.slug);
		for (const synonym of tag.synonyms ?? []) {
			addLookup(aliases, synonym, tag.slug);
		}
	}
	return aliases;
}

function addLookup(aliases: Map<string, string[]>, raw: string, slug: string) {
	for (const key of lookupKeys(raw)) {
		if (!key) continue;
		if (allTagSlugs.has(key) && key !== slug) continue;
		const existing = aliases.get(key);
		if (!existing) {
			aliases.set(key, [slug]);
			continue;
		}
		if (!existing.includes(slug)) existing.push(slug);
	}
}

function lookupKeys(value: string) {
	if (!value) return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	return [...new Set([trimmed, trimmed.toLowerCase(), slugify(trimmed)].filter(Boolean))];
}