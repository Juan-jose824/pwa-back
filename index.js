const webpush=require('web-push');
const vapidKeys = {
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY
};


webpush.setVapidDetails(
    'mailto:juanjoserivera1928@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function sendPush(req, res){
    const sub={/*suscripcion*/}
    webpush.sendNotification(sub, "{'titulo':'hola', 'mensaje':'holis', 'icon': 'nameimagen.jpg'}")
    .then(succes=>{
        res.json({menesaje:"ok"})
    })
    .catch(async error=>{
        if(error.body.includes('expired') && error.statusCode==410){
            console.log('suscripcion expirada')
            }
        })
}