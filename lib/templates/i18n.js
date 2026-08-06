/**
 * lib/email/templates/i18n.js
 * ─────────────────────────────────────────────────────────────
 * All customer-facing email copy, in German and English, in one
 * place. Templates pull strings from here instead of hardcoding
 * text, so adding a language later means adding one more key per
 * entry — not touching every template file.
 */
const STRINGS = {
  de: {
    labels: {
      orderNumber:    'Bestellnummer',
      items:           'Bestellte Artikel',
      subtotal:         'Zwischensumme',
      deliveryFee:       'Liefergebühr',
      total:              'Gesamtbetrag',
      estimatedTime:       'Voraussichtliche Lieferzeit',
      estimatedTimePickup:  'Voraussichtliche Abholzeit',
      currentStatus:          'Aktueller Status',
      thanksFooter:            'Vielen Dank, dass Sie bei Takashi bestellt haben!',
      questionsFooter:          'Fragen zu Ihrer Bestellung? Rufen Sie uns gerne an.'
    },
    statuses: {
      new: {
        subject: (id) => `Ihre Bestellung ${id} ist eingegangen`,
        title:    'Bestellung eingegangen',
        subtitle:  'Wir haben Ihre Bestellung erhalten und bereiten sie in Kürze vor.'
      },
      accepted: {
        subject: (id) => `Bestellung ${id} wurde angenommen`,
        title:    'Bestellung angenommen',
        subtitle:  'Die Küche hat Ihre Bestellung angenommen und beginnt mit der Zubereitung.'
      },
      cooking: {
        subject: (id) => `Ihre Bestellung ${id} wird zubereitet`,
        title:    'In Zubereitung',
        subtitle:  'Unsere Küche bereitet Ihre Bestellung mit Sorgfalt zu.'
      },
      on_the_way: {
        subject: (id) => `Bestellung ${id} ist unterwegs`,
        title:    'Ihre Bestellung ist unterwegs',
        subtitle:  'Der Fahrer ist losgefahren und bald bei Ihnen.'
      },
      delivered: {
        subject: (id) => `Bestellung ${id} wurde zugestellt`,
        title:    'Zugestellt',
        subtitle:  'Guten Appetit! Wir hoffen, es schmeckt Ihnen.'
      }
    }
  },
  en: {
    labels: {
      orderNumber:    'Order number',
      items:           'Order items',
      subtotal:         'Subtotal',
      deliveryFee:       'Delivery fee',
      total:              'Total',
      estimatedTime:       'Estimated delivery time',
      estimatedTimePickup:  'Estimated pickup time',
      currentStatus:          'Current status',
      thanksFooter:            'Thank you for ordering from Takashi!',
      questionsFooter:          'Questions about your order? Feel free to call us.'
    },
    statuses: {
      new: {
        subject: (id) => `Your order ${id} has been received`,
        title:    'Order received',
        subtitle:  'We\u2019ve received your order and will start preparing it shortly.'
      },
      accepted: {
        subject: (id) => `Order ${id} has been accepted`,
        title:    'Order accepted',
        subtitle:  'The kitchen has accepted your order and is getting started.'
      },
      cooking: {
        subject: (id) => `Your order ${id} is being prepared`,
        title:    'Preparing your order',
        subtitle:  'Our kitchen is carefully preparing your order.'
      },
      on_the_way: {
        subject: (id) => `Order ${id} is on its way`,
        title:    'Your order is on its way',
        subtitle:  'Your driver has left and will be with you soon.'
      },
      delivered: {
        subject: (id) => `Order ${id} has been delivered`,
        title:    'Delivered',
        subtitle:  'Enjoy your meal! We hope you love it.'
      }
    }
  }
};

/* Always returns a valid language block — falls back to German
   (the restaurant's primary market) for anything unrecognized. */
function getStrings(lang) {
  return STRINGS[lang] || STRINGS.de;
}

module.exports = { getStrings };
