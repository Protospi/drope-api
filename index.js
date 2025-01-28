const express = require('express')
const app = express()
const PORT = 8000

app.get('/', (req, resp)=>{
  resp.send('Node API')
})

app.listen(PORT, ()=>{
  console.log(`Listening to port ${PORT}`)
});