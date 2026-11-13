// The journal's rundown of every fish and bird: a few friendly lines and a typical size.
// Where, when and how rare an animal is comes from the game data (see panels/album.ts),
// so only the things the data doesn't know live here.

export interface Rundown {
  /** Two or three short sentences. */
  text: string;
  /** Typical size, e.g. "30–60 cm". */
  size: string;
}

export const RUNDOWN: Record<string, Rundown> = {
  // ── Fish ──────────────────────────────────────────────────────────────────
  fish_carp: { size: '30–80 cm', text: 'A patient, bronze-scaled bottom feeder that sifts through mud for snails and seeds. Carp can live for decades and grow surprisingly big.' },
  fish_perch: { size: '15–35 cm', text: 'Easy to spot by its dark stripes, spiny back fin and bright orange belly fins. Young perch hunt in shoals near weeds.' },
  fish_pike: { size: '50–120 cm', text: 'A long, olive-green ambush hunter with a duck-shaped snout full of teeth. It waits motionless in the reeds, then strikes in a flash.' },
  fish_trout: { size: '25–50 cm', text: 'Named for the pink-violet stripe along its side. Rainbow trout love cool, clear, fast-flowing water and leap for insects.' },
  fish_salmon: { size: '60–100 cm', text: 'Born in rivers, grown at sea – then back upstream to spawn, jumping waterfalls on the way. Its flesh is famously pink.' },
  fish_char: { size: '30–60 cm', text: 'The most northern freshwater fish of all, at home in icy lakes. In spawning season its belly glows red-orange.' },
  fish_tilapia: { size: '20–40 cm', text: 'A hardy, warm-water fish that grazes on algae. Tilapia parents guard their young – some even carry them in their mouths.' },
  fish_koi: { size: '40–90 cm', text: 'A carp bred over centuries for its gleaming colours. A golden koi is a sign of good luck, and can live longer than a person.' },
  fish_catfish: { size: '40–150 cm', text: 'Long whiskers called barbels help it taste its way through dark, muddy water. It comes out to feed when the sun goes down.' },
  fish_piranha: { size: '15–35 cm', text: 'Famous for its sharp, interlocking teeth, but mostly a shy scavenger. Its red belly flashes as the shoal turns.' },
  fish_bitterling: { size: '5–9 cm', text: 'A tiny, shimmering pond fish. It lays its eggs inside freshwater mussels, which keep them safe until they hatch.' },
  fish_goldfish: { size: '10–25 cm', text: 'A little orange relative of the carp with a flowing tail. Hardier than it looks, and it can tell its keeper apart from strangers.' },
  fish_frog: { size: '6–10 cm', text: 'Not a fish at all! A pond frog that snapped at your bait. It starts life as a tadpole and croaks loudest on warm, wet nights.' },
  fish_dace: { size: '15–25 cm', text: 'A slim, silvery river fish that dashes about in small groups. Quick and nervous – the name comes from "dart".' },
  fish_eel: { size: '50–100 cm', text: 'A slippery, snake-like fish that hunts at night. River eels swim thousands of kilometres out to sea to lay their eggs.' },
  fish_sweetfish: { size: '15–30 cm', text: 'A slender summer fish that scrapes algae off river stones. It is said to smell faintly of cucumber or melon.' },
  fish_sturgeon: { size: '1–3 m', text: 'An ancient giant whose family swam with the dinosaurs. Instead of scales it wears rows of bony plates down its back.' },
  fish_arowana: { size: '60–100 cm', text: 'A shining "dragon fish" with large scales and an upturned mouth. It can leap clean out of the water to snatch insects.' },
  fish_sardine: { size: '15–20 cm', text: 'A small, silvery fish that travels in shoals of millions. Whole ecosystems – from seabirds to whales – depend on them.' },
  fish_mackerel: { size: '30–40 cm', text: 'A fast, sleek swimmer with dark wavy stripes on a blue-green back. It never stops moving, even when it sleeps.' },
  fish_seabass: { size: '40–70 cm', text: 'A silvery, spiny-finned hunter of rocky coasts and estuaries. It rides the surf to chase crabs and small fish.' },
  fish_cod: { size: '50–100 cm', text: 'A speckled, big-mouthed fish of cold seas with a single whisker on its chin. Cod once fed whole nations.' },
  fish_herring: { size: '20–30 cm', text: 'A shimmering blue-silver fish that moves in enormous shoals. Herring talk to each other with tiny bubbles.' },
  fish_clownfish: { size: '8–11 cm', text: 'Orange with bold white bands, living safely among the stinging tentacles of a sea anemone that it keeps clean.' },
  fish_butterfly: { size: '12–20 cm', text: 'A flat, bright yellow reef fish. The dark band over its eye and a spot near its tail fool predators about which way it is going.' },
  fish_tuna: { size: '1–2 m', text: 'A powerful ocean racer built like a torpedo. Tuna are warm-blooded for a fish and can cross whole oceans.' },
  fish_mahi: { size: '80–150 cm', text: 'Also called dorado: a blunt-headed fish in dazzling green, gold and blue. Its colours flash and change as it swims.' },
  fish_seabream: { size: '30–50 cm', text: 'A tall, rosy-pink fish speckled with tiny blue dots. Prized at celebrations as a symbol of good fortune.' },
  fish_oarfish: { size: '3–8 m', text: 'The longest bony fish in the world – a silver ribbon with a red crest that lives in the deep. It surfaces only at night, and very rarely.' },

  // ── Birds ─────────────────────────────────────────────────────────────────
  bird_sparrow: { size: '15 cm', text: 'A chirpy little brown bird that has lived alongside people for thousands of years. Sparrows love dust baths and noisy get-togethers.' },
  bird_robin: { size: '14 cm', text: 'Round, with a bright orange breast. Robins sing all through the winter and like to follow gardeners to grab worms.' },
  bird_blue_tit: { size: '12 cm', text: 'A tiny acrobat in blue, yellow and green that hangs upside down to pick insects off twigs.' },
  bird_magpie: { size: '45 cm', text: 'A clever black-and-white bird with a long, shimmering tail. Magpies can recognise themselves in a mirror.' },
  bird_crow: { size: '47 cm', text: 'All-black and very smart: crows use tools, remember faces and even hold "meetings" with their families.' },
  bird_woodpecker: { size: '23 cm', text: 'Black, white and red, it drums on tree trunks to find food and call to its mate – up to 20 hits a second.' },
  bird_owl: { size: '38 cm', text: 'A round-faced hunter of the night. Its soft feathers make it almost silent in flight – listen for its "too-wit, too-woo".' },
  bird_bullfinch: { size: '16 cm', text: 'A plump finch with a black cap and a rosy-red chest. Quiet and shy, it nibbles buds and seeds in winter hedges.' },
  bird_snow_bunting: { size: '16 cm', text: 'A hardy, snow-white bird of the far north. Flocks of them swirl over frozen fields like falling snowflakes.' },
  bird_waxwing: { size: '18 cm', text: 'A crested, soft-pink bird with a black mask and waxy red tips on its wings. Flocks arrive in winter to feast on berries.' },
  bird_kingfisher: { size: '17 cm', text: 'A dazzling blue-and-orange flash along the riverbank. It dives headfirst to spear fish with its dagger-like beak.' },
  bird_pheasant: { size: '90 cm', text: 'A showy bird with a golden crest, a red body and an enormously long tail. Despite its colours, it is hard to spot in the woods.' },
  bird_seagull: { size: '60 cm', text: 'Loud, bold and clever – the coast\'s best scavenger. Gulls tap their feet on the sand to bring worms to the surface.' },
  bird_sandpiper: { size: '20 cm', text: 'A small wader on long legs that scurries along the waterline, probing the wet sand for tiny creatures.' },
  bird_parrot: { size: '85 cm', text: 'A huge red, yellow and blue parrot with a beak strong enough to crack nuts. Macaws pair up for life.' },
  bird_toucan: { size: '60 cm', text: 'Its giant orange bill is light as a sponge inside and helps it reach fruit – and keep cool in the heat.' },
  bird_hummingbird: { size: '8 cm', text: 'A jewel-like little bird whose wings beat so fast they hum. It is the only bird that can fly backwards.' },
  bird_lorikeet: { size: '30 cm', text: 'A rainbow-coloured parrot with a brush-tipped tongue for lapping up nectar. Noisy, playful and always in pairs.' },
  bird_flamingo: { size: '1.2 m', text: 'Tall, pink and often standing on one leg. Flamingos get their colour from the shrimp and algae they eat.' },
  bird_roadrunner: { size: '55 cm', text: 'A desert bird that would rather run than fly – it can sprint faster than most people. It even catches snakes.' },
  bird_lark: { size: '16 cm', text: 'A sandy-coloured songbird perfectly camouflaged on desert ground. It sings high in the air as it flies.' },
  bird_hoopoe: { size: '27 cm', text: 'Orange with a fan-shaped crest and zebra-striped wings. Its soft "hoop-hoop-hoop" call gave it its name.' },
  bird_nightjar: { size: '26 cm', text: 'A mottled bird of dusk that hides in plain sight on the ground by day and catches moths at night with its wide mouth.' },
};
