import Bar from './components/Bar.jsx';
import Hero from './components/Hero.jsx';
import Does from './components/Does.jsx';
import Agents from './components/Agents.jsx';
import Strip from './components/Strip.jsx';
import Download from './components/Download.jsx';
import Credits from './components/Credits.jsx';
import Footer from './components/Footer.jsx';

// One page, one section per component. Nothing here holds state or fetches:
// a static page that happens to be built with React.
export default function App() {
  return (
    <>
      <Bar />
      <main id="top">
        <Hero />
        <Does />
        <Agents />
        <Strip />
        <Download />
        <Credits />
      </main>
      <Footer />
    </>
  );
}
