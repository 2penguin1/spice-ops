import { Link } from 'react-router-dom'

import { MENU, photoUrl } from '../lib/menu'
import { formatMoney } from '../lib/format'
import './landing.css'

/**
 * The public face of the restaurant, and the way staff reach the sign-in page.
 *
 * Deliberately nothing about how the system is built — the people who read
 * this are looking for the food, and the staff who use it already know.
 */
export function Landing() {
  return (
    <div className="landing">
      <header className="hero">
        <div className="hero-photo" />

        <div className="hero-body">
          <p className="hero-eyebrow">Kitchen &amp; grill</p>
          <h1 className="hero-name">Spice Garden</h1>
          <div className="hero-rule" />
          <p className="hero-line">
            Biryani from the dum pot, dosa off the griddle, and bread straight out of the tandoor.
          </p>
          <Link className="hero-cta" to="/login">
            Staff sign in
          </Link>
        </div>

        <a className="hero-scroll" href="#menu" aria-label="See the menu">
          <span />
        </a>
      </header>

      <section className="menu-section" id="menu">
        <div className="menu-head">
          <p className="menu-eyebrow">The menu</p>
          <h2>Cooked to order, all day</h2>
        </div>

        <div className="dishes">
          {MENU.map((dish) => (
            <article className="dish" key={dish.itemName}>
              <div className="dish-frame">
                <img src={photoUrl(dish.photo)} alt={dish.itemName} loading="lazy" />
              </div>
              <div className="dish-line">
                <h3>{dish.itemName}</h3>
                <span className="dish-price">{formatMoney(dish.unitPrice)}</span>
              </div>
              <span
                className={`diet diet-${dish.diet}`}
                title={dish.diet === 'veg' ? 'Vegetarian' : 'Non-vegetarian'}
              />
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <p className="foot-mark">Spice Garden</p>
        <Link to="/login">Staff sign in</Link>
      </footer>
    </div>
  )
}
