fetch("https://kp12performance.onrender.com/api/data")
  .then(response => response.json())
  .then(data => {
    // This finds your <div> with id="data-container" and replaces the text!
    document.getElementById("data-container").innerText = data.message;
  })
  .catch(error => {
    console.error("Error fetching data:", error);
    document.getElementById("data-container").innerText = "Failed to load data.";
  });