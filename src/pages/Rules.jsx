import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import './Rules.css';

const SPECIALS = {
  hr: [
    { emoji: '🌉', name: 'MOST',    desc: 'Igrač čija je figurica aktivirala ili stala na MOST odlučuje hoće li figurica ostati ili s njom prelazi most.' },
    { emoji: '🎲', name: 'KOCKA',   desc: 'Igrač čija je figurica aktivirala ili stala na KOCKU baca dvije kocke i mora pokušati pomaknuti figuricu za dobiveni zbroj.' },
    { emoji: '⏪', name: 'REWIND',  desc: 'Figurica koja je aktivirala ili stala na REWIND mora se kretati suprotno od kazaljke na satu na idućem potezu kada igrač odluči pomaknuti tu figuricu. Figurica ne može ići izvan svojeg izlaza u unutarnjem ili vanjskom prstenu.' },
    { emoji: '💣', name: 'BOMBA',   desc: 'Figurica koja je aktivirala BOMBU mora se pomaknuti na idućem potezu ili će biti vraćena u svoj kvadratić HOME. Figurica koja stane na BOMBU vraća se u svoj kvadratić HOME i igrač koji je stao na bombu uzima je u ruku za ponovno postavljanje.' },
    { emoji: '⏸️', name: 'STOP',    desc: 'Figurica koja je aktivirala ili stala na STOP smije se kretati samo za jedno polje kada se na kocki dobije broj jedan.' },
    { emoji: '🔄', name: 'ZAMJENA', desc: 'Igrač ćija je figurica stala na ZAMJENU bira slobodnu figuricu (izvan kvadratića HOME i FINISH) boje igrača koji je postavio to "posebno polje". Ako nema slobodnih figurica te boje zamjena se ne izvršava.' },
  ],
  en: [
    { emoji: '🌉', name: 'BRIDGE', desc: 'The player whose piece just activated or has landed on the BRIDGE decides whether to stay or cross to the parallel ring with that piece.' },
    { emoji: '🎲', name: 'DICE',   desc: 'The player whose piece just activated or has landed on the DICE roll two dice and must attempt to move that piece for the given sum.' },
    { emoji: '⏪', name: 'REWIND', desc: 'The piece which activated or landed on the REWIND must move counter-clockwise on its next turn when the player decides to move that piece. The piece can\'t go beyond his exit point in the inner or outer ring.' },
    { emoji: '💣', name: 'BOMB',   desc: 'The piece which activated BOMB must be moved on the player\'s next move or it will be returned to HOME. The piece that lands on a BOMB returns to HOME, and that player picks up the bomb to use again later.' },
    { emoji: '⏸️', name: 'STOP',   desc: 'The piece which activated or landed on the STOP can move only when the dice shows 1.' },
    { emoji: '🔄', name: 'SWAP',   desc: 'The player of the piece which landed on the SWAP choose a eligible piece (outside HOME and FINISH slots) which belongs to the player who placed this swap. If no eligible pieces exist, no swap occurs.' },
  ],
};

function Rule({ num, children }) {
  return (
    <div className="rules-rule">
      <span className="rules-rule-num">{num}</span>
      <span>{children}</span>
    </div>
  );
}

function SubRule({ num, children }) {
  return (
    <div className="rules-rule rules-rule--sub">
      <span className="rules-rule-num">{num}</span>
      <span>{children}</span>
    </div>
  );
}

function SpecialRow({ emoji, name, desc }) {
  return (
    <div className="rules-special-row">
      <span className="rules-special-emoji">{emoji}</span>
      <div className="rules-special-text">
        <strong>{name}</strong>
        <span> - {desc}</span>
      </div>
    </div>
  );
}

export function RulesContent({ lang }) {
  const hr = lang === 'hr';
  const specials = SPECIALS[lang];
  return (
    <div className="rules-content">
      <Rule num="1.">
        {hr
          ? 'Na početku igre svaki igrač (2 do 8 igrača) ima 4 figurice iste boje smještene u kvadrat HOME te iste boje. Cilj je smjestiti sve figurice u kućicu iste boje označene brojevima 1 do 4 kretanjem po mapi u smjeru kazaljke na satu.'
          : 'Each player (2-8) starts with 4 pieces of their color in their HOME area. The goal is to move all pieces into the numbered finish slots (1-4) by traveling clockwise around the board.'}
      </Rule>
      <Rule num="2.">
        {hr
          ? 'Bacanjem kocke određuje se igrač koji prvi počinje igru. Ako je više istih najvećih brojeva tada ti igrači bacaju ponovno dok se ne dobije jedan igrač s najvećim brojem. Sljedeći igrač na potezu je u smjeru kazaljke na satu.'
          : 'Roll to determine who goes first. Tied highest rolls re-roll among themselves until one winner emerges. The next player in turn order is always clockwise.'}
      </Rule>
      <Rule num="3.">
        {hr
          ? 'Ako igrač koji je na potezu ima sve figurice u kvadratu HOME ili su uzastopno poredani u kućicama od 4 prema niže tada igrač ima 3 bacanja da dobije 6.'
          : 'If all of a player\'s pieces are in HOME, or consecutively placed in finish slots counting down from 4, that player gets 3 rolls to try to get a 6.'}
      </Rule>
      <Rule num="4.">
        {hr
          ? 'Figuricom se može izaći ako se dobije 6. Svaka boja ima dva moguća izlaza: jedan u manjem krugu, drugi u većem krugu.'
          : 'A piece can exit HOME only on a roll of 6. Each color has two exits: one on the inner ring (shorter route) and one on the outer ring (longer route).'}
      </Rule>
      <Rule num="5.">
        {hr
          ? 'Svako polje na mapi se broji kao jedan. Čitav broj dobiven na kocki mora se iskoristiti za jednu figuricu za kretanje po mapi u smjeru kazaljke na satu do polja neposredno prije izlaska za igrača te boje u unutarnjem krugu. U vanjskom krugu, figurica može nastaviti kretanje kontinuirano. Ako nema mogućih ispravnih poteza tada je na redu idući igrač.'
          : 'Every square counts as one step. The full dice value must be used for a single piece moving clockwise, stopping before the color\'s own finish entry in inner ring. In outer ring, the piece may continue moving continuously. If no valid move exists, the next player takes their turn.'}
      </Rule>
      <Rule num="6.">
        {hr
          ? 'Igrač koji dobije 6 ima pravo na još jedno bacanje.'
          : 'Rolling a 6 grants one additional roll.'}
      </Rule>
      <Rule num="7.">
        {hr
          ? 'Na istom polju smije biti samo jedna figurica.'
          : 'Only one piece may occupy any single square at a time.'}
      </Rule>
      <Rule num="8.">
        {hr
          ? 'Ako figurica stane na isto polje gdje je figurica druge boje tada igrači čije su te figurice bacanjem kocke određuju koja figurica odlazi u svoj kvadratić HOME. Figurica čiji igrač dobije veći broj ostaje, a ako su brojevi isti igrači ponovno bacaju kocke dok netko ne dobije veći broj.'
          : 'If a piece lands on a square with an opponent\'s piece, both players roll the dice - the higher roll stays on the square. If tied, both re-roll until one gets a higher number.'}
      </Rule>
      <Rule num="9.">
        {hr
          ? 'Posebna polja su: MOST, KOCKA, REWIND, BOMBA, STOP i ZAMJENA.'
          : 'Special squares are: BRIDGE, DICE, REWIND, BOMB, STOP and SWAP.'}
      </Rule>
      <SubRule num="9.1.">
        {hr
          ? 'Ako je broj igrača jednak 4 ili manji tada svaki igrač dobiva 2 posebna polja svake vrste na početku igre, a ako j veći od 4 tada svaki igrač dobiva 1 posebno polje svake vrste.'
          : 'If there are 4 or fewer players, each player starts with 2 of each type of special square. If there are more than 4 players, each player starts with 1 of each type of special square.'}
      </SubRule>
      <SubRule num="9.2.">
        {hr
          ? 'Nakon što igrač koji je na potezu odigra s figuricom, na to polje na kojem je stala figurica igrač može postaviti posebno polje koje ima u ruci - ako to polje već nije posebno i nije polje izlaska iz kuće. Za MOST mora postojati paralelni kvadratić bez specijalnog polja i MOST ne smije prelaziti preko kvadratića HOME.'
          : 'After the active player moves a piece, they may place a special square from their hand onto the square just landed - provided it is not already a special square and not the exit cell from home. For BRIDGE, a parallel cell without special cell must exist, and the BRIDGE may not cross over HOME cells.'}
      </SubRule>
      <SubRule num="9.3.">
        {hr
          ? 'Posebno polje se odmah aktivira za figuricu koja je na tom polju. Ako je postavljena bomba, ta figurica se u idućem potezu mora pomaknuti ili odlazi u svoj kvadratić HOME.'
          : 'A placed special square activates immediately for the piece on that square. If a bomb is placed, the piece must move on its next turn or it returns to HOME.'}
      </SubRule>
      <SubRule num="9.4.">
        {hr
          ? 'Igrač koji je na potezu i dobio 6 može odabrati figuricu koja se nalazi na nekom posebnom polju i uzeti to posebno polje u ruku za kasnije postavljanje. Igrač zatim ponovno baca kocku.'
          : 'A player who rolls 6 may pick up any special square that a piece is currently standing on, taking it into their hand for later placement. They then roll the dice again.'}
      </SubRule>
      <SubRule num="9.5.">
        {hr
          ? 'Posebno polje ostaje postavljeno do kraja igre ili dok ga neki igrač ne pokupi.'
          : 'A special square remains on the board until the end of the game or until a player picks it up.'}
      </SubRule>
      <div className="rules-specials">
        {specials.map((s, i) => (
          <SpecialRow key={s.name} emoji={s.emoji} name={`9.${String.fromCharCode(97 + i)}) ${s.name}`} desc={s.desc} />
        ))}
      </div>
      <Rule num="10.">
        {hr
          ? 'Igrač koji prvi poreda svoje figurice u FINISH kućice označene od 1 do 4 je pobijedio.'
          : 'The first player to fill all FINISH slots 1-4 with their pieces wins.'}
      </Rule>
    </div>
  );
}

export default function Rules() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="rules-page page">
      <div className="rules-header">
        <button className="btn btn-ghost setup-back-btn" onClick={() => navigate('/')}>←</button>
        <h2 className="rules-title">{t('rulesTitle')}</h2>
        <div className="setup-header-actions">
          <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '🔅'}
          </button>
        </div>
      </div>
      <div className="rules-scroll">
        <RulesContent lang={lang} />
      </div>
    </div>
  );
}